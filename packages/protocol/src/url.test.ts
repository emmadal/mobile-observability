import { describe, expect, it } from 'vitest';
import { sanitizeUrl, templatePath } from './url.js';

describe('templatePath (AC-5)', () => {
  it.each([
    ['/users/123', '/users/:id'],
    ['/users/123/orders/456', '/users/:id/orders/:id'],
    ['/items/0b9a3b3e-4c7e-4b0b-9d0c-2f3e1d3a6b7c', '/items/:id'],
    ['/blobs/a3f9c2d1e8b7a6f5c4d3', '/blobs/:id'],
    ['/v1/search', '/v1/search'],
    ['/products/shoes', '/products/shoes'],
    ['/', '/'],
    ['', '/'],
    ['/users/123/', '/users/:id/'],
  ])('%s -> %s', (input, expected) => {
    expect(templatePath(input)).toBe(expected);
  });

  it('keeps short hex-looking words such as "cafe" or "add"', () => {
    expect(templatePath('/cafe/add')).toBe('/cafe/add');
  });
});

describe('sanitizeUrl', () => {
  it('strips query and fragment, and templates the path', () => {
    expect(sanitizeUrl('https://api.example.com/users/123?token=abc#frag')).toEqual({
      host: 'api.example.com',
      path: '/users/:id',
    });
  });

  it('keeps a non-default port in the host', () => {
    expect(sanitizeUrl('http://localhost:3000/api/v1/envelope?x=1')).toEqual({
      host: 'localhost:3000',
      path: '/api/v1/envelope',
    });
  });

  it('removes user info', () => {
    expect(sanitizeUrl('https://user:secret@example.com/a')).toEqual({
      host: 'example.com',
      path: '/a',
    });
  });

  it('handles relative or invalid URLs without throwing', () => {
    expect(sanitizeUrl('/relative/42?q=1')).toEqual({ host: '', path: '/relative/:id' });
    expect(sanitizeUrl('not a url')).toEqual({ host: '', path: '/not a url' });
  });
});
