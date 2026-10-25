/**
 * Sends a file in chunks. Each request stays far below the five minutes after
 * which Termix's server (or a proxy before it) cuts a request off; a whole
 * 1.7 GiB image over a slow line never got there, and the browser started it
 * over from 0% each time.
 */

/** 16 MiB: seconds on any line, few enough requests on a fast one. */
export const CHUNK_SIZE = 16 * 1024 * 1024;
/**
 * Tries per chunk. A shaky line (connections to the proxy timing out now and
 * then) needs a few; ten with the pauses below ride out about four minutes.
 */
export const MAX_ATTEMPTS = 10;
/**
 * A chunk not done in this long (a hung connection, or under 0.14 MB/s) is
 * dropped and sent again. XHR's timeout is the whole request, not idle time.
 */
export const CHUNK_TIMEOUT_MS = 120_000;

export interface ChunkAnswer {
  status: number;
  body: { received?: number; done?: boolean; error?: string; code?: string };
}

export class UploadFailed extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

export interface ChunkUpload {
  total: number;
  chunkSize?: number;
  /** Sends bytes [offset, end); reports bytes of this chunk sent so far. */
  send: (
    offset: number,
    end: number,
    onProgress: (sent: number) => void,
  ) => Promise<ChunkAnswer>;
  /** How far the node has the file, for the progress bar. */
  onProgress: (sent: number) => void;
  cancelled: () => boolean;
  wait?: (ms: number) => Promise<void>;
}

/** Statuses a retry can't fix: a bad request, no right, no host, file there. */
const FINAL = new Set([400, 401, 403, 404, 413]);

export async function uploadInChunks(upload: ChunkUpload): Promise<void> {
  const size = upload.chunkSize ?? CHUNK_SIZE;
  const wait =
    upload.wait ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  let offset = 0;
  let attempts = 0;
  let lastError = "";
  while (true) {
    if (upload.cancelled()) throw new UploadFailed("cancelled", 0);
    const end = Math.min(offset + size, upload.total);
    let answer: ChunkAnswer;
    try {
      answer = await upload.send(offset, end, (sent) =>
        upload.onProgress(offset + sent),
      );
    } catch (err) {
      // The connection dropped: no answer at all.
      answer = { status: 0, body: { error: String(err) } };
    }
    if (upload.cancelled()) throw new UploadFailed("cancelled", 0);

    if (answer.status === 200) {
      attempts = 0;
      if (answer.body.done) {
        upload.onProgress(upload.total);
        return;
      }
      offset = answer.body.received ?? end;
      upload.onProgress(offset);
      continue;
    }
    // Out of step: carry on from what the node really has.
    if (
      answer.status === 409 &&
      answer.body.code === "PVE_UPLOAD_OFFSET" &&
      answer.body.received !== undefined
    ) {
      offset = answer.body.received;
      upload.onProgress(offset);
      attempts += 1;
    } else if (
      FINAL.has(answer.status) ||
      (answer.status === 409 && answer.body.code !== "PVE_UPLOAD_OFFSET")
    ) {
      throw new UploadFailed(
        answer.body.error ?? `HTTP ${answer.status}`,
        answer.status,
      );
    } else {
      attempts += 1;
      lastError = answer.body.error ?? `HTTP ${answer.status}`;
      upload.onProgress(offset);
    }
    if (attempts >= MAX_ATTEMPTS) {
      throw new UploadFailed(lastError || "The upload kept failing", 502);
    }
    // 1, 2, 4, 8 … seconds, up to 30, so a node or network blip can pass.
    await wait(Math.min(30_000, 1000 * 2 ** (attempts - 1)));
  }
}

/** A short random id that names this upload's temporary file on the node. */
export function uploadId(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}
