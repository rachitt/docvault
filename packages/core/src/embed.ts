/**
 * Local-first text embeddings for semantic search.
 *
 * Uses transformers.js (`@xenova/transformers`) with the `Xenova/all-MiniLM-L6-v2`
 * model (384-dim, mean-pooled + L2-normalized) so embeddings run fully on-device
 * with no API keys and no network at query time. The model is downloaded and
 * cached by the library on first use (a one-time ~25MB fetch); subsequent loads
 * are offline from the local cache.
 *
 * The default embedder lazy-loads the model on first `embed()` call and caches
 * the pipeline for the process lifetime. The `Embedder` interface is the seam:
 * callers (and especially tests) can inject a stub so nothing depends on a model
 * download.
 */

/** Dimensionality of the all-MiniLM-L6-v2 sentence embedding. */
export const EMBED_DIM = 384;

/** Model id embeddings are produced with; stored alongside vectors so a model
 *  swap can be detected and trigger a re-embed if ever needed. */
export const EMBED_MODEL = 'Xenova/all-MiniLM-L6-v2';

/**
 * Produces a normalized embedding vector per input text. Implementations should
 * return one `Float32Array` of length {@link EMBED_DIM} per input, in order.
 */
export interface Embedder {
  /** Embed a batch of texts. Empty input → empty output. */
  embed(texts: string[]): Promise<Float32Array[]>;
  /** Dimensionality of the vectors this embedder produces. */
  readonly dim: number;
}

type FeatureExtractor = (
  texts: string[],
  opts: { pooling: 'mean'; normalize: boolean },
) => Promise<{ data: Float32Array; dims: number[] }>;

/**
 * The default on-device embedder. The model pipeline is created lazily on first
 * use and memoized; concurrent first-callers share a single load via a cached
 * promise. Texts are embedded in bounded batches to keep memory predictable.
 */
export class TransformersEmbedder implements Embedder {
  readonly dim = EMBED_DIM;
  private pipelinePromise: Promise<FeatureExtractor> | null = null;
  private readonly model: string;
  private readonly batchSize: number;

  constructor(opts: { model?: string; batchSize?: number } = {}) {
    this.model = opts.model ?? EMBED_MODEL;
    this.batchSize = opts.batchSize ?? 16;
  }

  /** Lazily load (and cache) the feature-extraction pipeline. */
  private getPipeline(): Promise<FeatureExtractor> {
    if (!this.pipelinePromise) {
      this.pipelinePromise = (async () => {
        // Dynamic import so merely importing core doesn't pull in the (heavy)
        // ML runtime until semantic search is actually used.
        const { pipeline } = await import('@xenova/transformers');
        const extractor = await pipeline('feature-extraction', this.model);
        return extractor as unknown as FeatureExtractor;
      })().catch((err) => {
        // Reset so a transient failure (e.g. first-run download interrupted)
        // can be retried on the next call rather than poisoning the cache.
        this.pipelinePromise = null;
        throw err;
      });
    }
    return this.pipelinePromise;
  }

  async embed(texts: string[]): Promise<Float32Array[]> {
    if (texts.length === 0) return [];
    const extract = await this.getPipeline();
    const out: Float32Array[] = [];
    for (let i = 0; i < texts.length; i += this.batchSize) {
      const batch = texts.slice(i, i + this.batchSize);
      const result = await extract(batch, { pooling: 'mean', normalize: true });
      // result.data is a flat Float32Array of [batch, dim]; slice per row.
      const dim = result.dims[result.dims.length - 1] ?? this.dim;
      for (let r = 0; r < batch.length; r++) {
        out.push(result.data.slice(r * dim, (r + 1) * dim));
      }
    }
    return out;
  }
}

/** Cosine similarity of two equal-length vectors. Returns 0 for a zero vector. */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  const n = Math.min(a.length, b.length);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i]!;
    const y = b[i]!;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** Encode a vector as a compact little-endian Float32 BLOB for SQLite storage. */
export function vectorToBlob(vec: Float32Array): Buffer {
  return Buffer.from(vec.buffer, vec.byteOffset, vec.byteLength);
}

/** Decode a Float32 BLOB (as stored by {@link vectorToBlob}) back to a vector. */
export function blobToVector(blob: Buffer): Float32Array {
  // Copy into an aligned buffer: a SQLite BLOB's byteOffset may be non-multiple
  // of 4, which Float32Array's constructor rejects when viewing in place.
  const bytes = Uint8Array.prototype.slice.call(blob);
  return new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
}
