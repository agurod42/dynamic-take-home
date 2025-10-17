import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  HttpError,
  badRequest,
  unauthorized,
  forbidden,
  notFound,
  conflict,
  internalError,
} from '../httpError.js';

test('badRequest creates a 400 HttpError', () => {
  const error = badRequest('Invalid input');
  assert.ok(error instanceof HttpError);
  assert.equal(error.status, 400);
  assert.equal(error.message, 'Invalid input');
});

test('unauthorized defaults to 401 with fallback message', () => {
  const error = unauthorized();
  assert.ok(error instanceof HttpError);
  assert.equal(error.status, 401);
  assert.equal(error.message, 'Unauthorized');
});

test('forbidden creates a 403 error with custom message', () => {
  const error = forbidden('Nope');
  assert.ok(error instanceof HttpError);
  assert.equal(error.status, 403);
  assert.equal(error.message, 'Nope');
});

test('notFound and conflict create expected errors', () => {
  const notFoundError = notFound('Missing');
  const conflictError = conflict('Exists');
  assert.ok(notFoundError instanceof HttpError);
  assert.ok(conflictError instanceof HttpError);
  assert.equal(notFoundError.status, 404);
  assert.equal(conflictError.status, 409);
});

test('internalError defaults to status 500 and message', () => {
  const error = internalError();
  assert.ok(error instanceof HttpError);
  assert.equal(error.status, 500);
  assert.equal(error.message, 'Internal Server Error');
});
