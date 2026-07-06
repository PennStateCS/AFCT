import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { normalizeZodError, validationResponse } from './zod-error';

describe('zod-error', () => {
  describe('normalizeZodError', () => {
    it('should return null for non-ZodError instances', () => {
      const regularError = new Error('Regular error');
      expect(normalizeZodError(regularError)).toBeNull();
      expect(normalizeZodError(null)).toBeNull();
      expect(normalizeZodError(undefined)).toBeNull();
      expect(normalizeZodError('string error')).toBeNull();
      expect(normalizeZodError(123)).toBeNull();
    });

    it('should normalize a simple ZodError with single issue', () => {
      const schema = z.object({ email: z.string().email() });
      try {
        schema.parse({ email: 'invalid' });
      } catch (err) {
        const normalized = normalizeZodError(err);
        expect(normalized).toEqual([
          {
            path: 'email',
            message: 'Invalid email',
            code: 'invalid_string',
          },
        ]);
      }
    });

    it('should normalize ZodError with multiple issues', () => {
      const schema = z.object({
        email: z.string().email(),
        age: z.number().min(18),
        name: z.string().min(2),
      });

      try {
        schema.parse({ email: 'bad', age: 10, name: 'x' });
      } catch (err) {
        const normalized = normalizeZodError(err);
        expect(normalized).toHaveLength(3);
        expect(normalized).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              path: 'email',
              message: expect.any(String),
              code: expect.any(String),
            }),
            expect.objectContaining({
              path: 'age',
              message: expect.any(String),
              code: expect.any(String),
            }),
            expect.objectContaining({
              path: 'name',
              message: expect.any(String),
              code: expect.any(String),
            }),
          ]),
        );
      }
    });

    it('should normalize nested object paths with dot notation', () => {
      const schema = z.object({
        user: z.object({
          profile: z.object({
            email: z.string().email(),
          }),
        }),
      });

      try {
        schema.parse({ user: { profile: { email: 'invalid' } } });
      } catch (err) {
        const normalized = normalizeZodError(err);
        expect(normalized).toEqual([
          {
            path: 'user.profile.email',
            message: 'Invalid email',
            code: 'invalid_string',
          },
        ]);
      }
    });

    it('should normalize array paths', () => {
      const schema = z.object({
        items: z.array(z.number().positive()),
      });

      try {
        schema.parse({ items: [1, -2, 3] });
      } catch (err) {
        const normalized = normalizeZodError(err);
        expect(normalized).toEqual([
          expect.objectContaining({
            path: 'items.1',
            message: 'Number must be greater than 0',
          }),
        ]);
      }
    });

    it('should handle empty path for root-level errors', () => {
      const schema = z.string();
      try {
        schema.parse(123);
      } catch (err) {
        const normalized = normalizeZodError(err);
        expect(normalized).toEqual([
          {
            path: '',
            message: expect.any(String),
            code: 'invalid_type',
          },
        ]);
      }
    });

    it('should include error code in normalized issues', () => {
      const schema = z.string().min(5);
      try {
        schema.parse('abc');
      } catch (err) {
        const normalized = normalizeZodError(err);
        expect(normalized?.[0]?.code).toBe('too_small');
      }
    });
  });

  describe('validationResponse', () => {
    it('should return generic validation error for non-ZodError', () => {
      const regularError = new Error('Something went wrong');
      const response = validationResponse(regularError);

      expect(response.status).toBe(400);
      response.json().then((data) => {
        expect(data).toEqual({ message: 'Validation failed' });
      });
    });

    it('should return validation response with issues for ZodError', async () => {
      const schema = z.object({ email: z.string().email() });
      try {
        schema.parse({ email: 'invalid' });
      } catch (err) {
        const response = validationResponse(err);
        expect(response.status).toBe(400);

        const data = await response.json();
        expect(data.message).toBe('Validation failed');
        expect(data.issues).toEqual([
          {
            path: 'email',
            message: 'Invalid email',
            code: 'invalid_string',
          },
        ]);
      }
    });

    it('should accept custom ResponseInit options', async () => {
      const regularError = new Error('Test');
      const response = validationResponse(regularError, {
        status: 422,
        headers: { 'X-Custom': 'header' },
      });

      expect(response.status).toBe(422);
      expect(response.headers.get('X-Custom')).toBe('header');
    });

    it('should merge ResponseInit with default status 400', async () => {
      const schema = z.string();
      try {
        schema.parse(123);
      } catch (err) {
        const response = validationResponse(err, {
          headers: { 'Content-Type': 'application/json' },
        });

        expect(response.status).toBe(400);
        expect(response.headers.get('Content-Type')).toBe('application/json');
      }
    });

    it('should handle multiple validation issues in response', async () => {
      const schema = z.object({
        email: z.string().email(),
        password: z.string().min(8),
        age: z.number().min(18),
      });

      try {
        schema.parse({ email: 'bad', password: '123', age: 10 });
      } catch (err) {
        const response = validationResponse(err);
        const data = await response.json();

        expect(data.message).toBe('Validation failed');
        expect(data.issues).toHaveLength(3);
        expect(data.issues).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ path: 'email' }),
            expect.objectContaining({ path: 'password' }),
            expect.objectContaining({ path: 'age' }),
          ]),
        );
      }
    });

    it('should handle null and undefined errors gracefully', async () => {
      const response1 = validationResponse(null);
      const response2 = validationResponse(undefined);

      expect(response1.status).toBe(400);
      expect(response2.status).toBe(400);

      const data1 = await response1.json();
      const data2 = await response2.json();

      expect(data1).toEqual({ message: 'Validation failed' });
      expect(data2).toEqual({ message: 'Validation failed' });
    });
  });
});
