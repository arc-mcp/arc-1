import express, { type ErrorRequestHandler, type RequestHandler, type Response } from 'express';
import { isMcpHttpTraffic } from './auth-rate-limit.js';
import { MAX_HTTP_REQUEST_BYTES } from './types.js';

const SMALL_BODY_BYTES = 100 * 1024;
const IN_FLIGHT_BODY_BYTES = 32 * 1024 * 1024;

type BodyParserError = { status?: number; type?: string };

function sendBodyParserError(res: Response, err: BodyParserError, json?: { limit: number; mcp: boolean }) {
  if (err?.type === 'encoding.unsupported') {
    res.setHeader('Accept-Encoding', 'identity');
    res.status(415).json({ error: 'UNSUPPORTED_CONTENT_ENCODING', message: 'Send an uncompressed request body.' });
  } else if (err?.type === 'entity.too.large' && json) {
    res.status(413).json({
      error: 'HTTP_REQUEST_TOO_LARGE',
      limitBytes: json.limit,
      message: json.mcp
        ? 'Use a smaller request or ask the administrator to raise ARC1_MAX_HTTP_REQUEST_BYTES (maximum 16 MiB).'
        : 'Use a smaller JSON request.',
    });
  } else {
    const status = err?.status && err.status >= 400 && err.status < 500 ? err.status : 400;
    res.status(status).json({
      error: json ? 'INVALID_JSON_REQUEST' : status === 413 ? 'HTTP_REQUEST_TOO_LARGE' : 'INVALID_FORM_REQUEST',
      message: json ? 'Invalid JSON request body.' : 'Invalid or oversized form request body.',
    });
  }
}

/** Keep global form-parser failures JSON, including on public OAuth and unknown routes. */
export const handleHttpBodyParseError: ErrorRequestHandler = (err, _req, res, next) => {
  if (res.headersSent) return next(err);
  sendBodyParserError(res, err);
};

/** Bound larger JSON admissions until response completion/disconnect; small bodies keep the default behavior. */
export function createHttpJsonParser(maxRequestBytes: number): RequestHandler {
  if (!Number.isSafeInteger(maxRequestBytes) || maxRequestBytes < 1 || maxRequestBytes > MAX_HTTP_REQUEST_BYTES) {
    throw new Error(`maxHttpRequestBytes must be an integer between 1 and ${MAX_HTTP_REQUEST_BYTES}.`);
  }
  const smallParser = express.json({ limit: SMALL_BODY_BYTES, inflate: false });
  const mcpParser = express.json({ limit: maxRequestBytes, inflate: false });
  let reservedBytes = 0;
  return (req, res, next) => {
    if (!req.is('application/json')) return next();
    // Copilot's /authorize JSON body is classified as JSON-RPC only AFTER parsing.
    const mcp = isMcpHttpTraffic(req) || /^\/authorize\/*$/i.test(req.path);
    const limit = mcp ? maxRequestBytes : SMALL_BODY_BYTES;
    // Content-Length bounds accepted plain bodies; unknown lengths reserve the full limit.
    const declared = Number(req.headers['content-length']);
    const reservation = Math.min(limit, Number.isSafeInteger(declared) && declared >= 0 ? declared : limit);
    const budgeted = reservation > SMALL_BODY_BYTES;
    if (budgeted && reservedBytes + reservation > IN_FLIGHT_BODY_BYTES) {
      res.setHeader('Retry-After', '1');
      res
        .status(503)
        .json({ error: 'HTTP_BODY_CAPACITY', message: 'Insufficient capacity for this JSON request. Retry later.' });
      return;
    }
    if (budgeted) {
      reservedBytes += reservation;
      // 'close' also follows 'finish', and alone covers disconnects; release exactly once.
      let released = false;
      const release = () => {
        if (released) return;
        released = true;
        reservedBytes -= reservation;
      };
      res.once('finish', release);
      res.once('close', release);
    }
    (mcp ? mcpParser : smallParser)(req, res, (err?: BodyParserError) => {
      if (!err) return next();
      sendBodyParserError(res, err, { limit, mcp });
    });
  };
}
