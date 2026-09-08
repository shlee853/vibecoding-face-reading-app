/**
 * lib/image.ts — parseDataUrl() / validateImageDataUrl() 계약 검증.
 * 대응 수락 기준: A5
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parseDataUrl, validateImageDataUrl } from '../lib/image';
import { MAX_IMAGE_BYTES, ALLOWED_MIME_TYPES } from '../lib/types';

/** 정확히 byteLength 바이트를 디코딩할 수 있는 data URL을 만든다. */
function makeDataUrl(mimeType: string, byteLength: number): string {
  const buf = Buffer.alloc(byteLength, 7);
  return `data:${mimeType};base64,${buf.toString('base64')}`;
}

// ---- parseDataUrl -----------------------------------------------------------

describe('parseDataUrl', () => {
  test('정상 data URL에서 mimeType과 base64를 분리한다', () => {
    const buf = Buffer.from('hello world', 'utf-8');
    const b64 = buf.toString('base64');
    const url = `data:image/png;base64,${b64}`;
    const result = parseDataUrl(url);
    assert.notEqual(result, null);
    assert.equal(result!.mimeType, 'image/png');
    assert.equal(result!.base64, b64);
    assert.equal(Buffer.from(result!.base64, 'base64').toString('utf-8'), 'hello world');
  });

  test('data: 접두사가 없으면 null', () => {
    assert.equal(parseDataUrl('image/png;base64,AAAA'), null);
  });

  test('base64 마커가 없으면 null', () => {
    assert.equal(parseDataUrl('data:image/png,AAAA'), null);
  });

  test('완전히 관계없는 문자열은 null', () => {
    assert.equal(parseDataUrl('그냥 문자열입니다'), null);
  });

  test('빈 문자열은 null', () => {
    assert.equal(parseDataUrl(''), null);
  });
});

// ---- validateImageDataUrl: A5 5가지 분기 -------------------------------------

describe('validateImageDataUrl — 입력별 분기 (A5)', () => {
  test('undefined → NO_IMAGE', () => {
    const result = validateImageDataUrl(undefined);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, 'NO_IMAGE');
  });

  test('숫자 → NO_IMAGE', () => {
    const result = validateImageDataUrl(12345);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, 'NO_IMAGE');
  });

  test('빈 문자열 → NO_IMAGE', () => {
    const result = validateImageDataUrl('');
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, 'NO_IMAGE');
  });

  test('null → NO_IMAGE', () => {
    const result = validateImageDataUrl(null);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, 'NO_IMAGE');
  });

  test('일반 문자열(data URL 아님) → BAD_IMAGE_FORMAT', () => {
    const result = validateImageDataUrl('그냥 일반 문자열입니다');
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, 'BAD_IMAGE_FORMAT');
  });

  test('허용되지 않은 MIME(image/bmp) → BAD_IMAGE_FORMAT', () => {
    const url = makeDataUrl('image/bmp', 100);
    const result = validateImageDataUrl(url);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, 'BAD_IMAGE_FORMAT');
  });

  test('4MB 초과 → IMAGE_TOO_LARGE', () => {
    const url = makeDataUrl('image/jpeg', MAX_IMAGE_BYTES + 1);
    const result = validateImageDataUrl(url);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, 'IMAGE_TOO_LARGE');
  });

  test('경계: 정확히 4MB이면 초과가 아니므로 ok', () => {
    const url = makeDataUrl('image/jpeg', MAX_IMAGE_BYTES);
    const result = validateImageDataUrl(url);
    assert.equal(result.ok, true);
  });

  for (const mime of ALLOWED_MIME_TYPES) {
    test(`허용 MIME "${mime}" 정상 이미지 → ok:true + mimeType/base64 정확 분리`, () => {
      const buf = Buffer.alloc(2048, 42);
      const b64 = buf.toString('base64');
      const url = `data:${mime};base64,${b64}`;
      const result = validateImageDataUrl(url);
      assert.equal(result.ok, true);
      if (result.ok) {
        assert.equal(result.mimeType, mime);
        assert.equal(result.base64, b64);
      }
    });
  }
});
