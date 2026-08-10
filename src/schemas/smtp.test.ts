import { describe, expect, it } from 'vitest';
import { SmtpSettingsSchema, SendTestEmailSchema } from './smtp';

const fromAddress = SmtpSettingsSchema.shape.smtpFromAddress;
const accepts = (v: string) => fromAddress.safeParse(v).success;

/**
 * The from address is deliberately not validated as a strict email.
 *
 * A strict check requires a dotted domain, which rejected `afct@localhost`: a real, usable
 * address, and the one the local mail catcher in the dev stack wants. It caught almost nothing
 * in exchange, since a typo in a real domain (`afct@examplecom`) passes a strict check too. The
 * mail server has the final say, and a sender it refuses comes back through the mailer as a
 * message that names the problem.
 */
describe('the from address', () => {
  it('accepts an address at a dotless host, which is what broke', () => {
    expect(accepts('afct@localhost')).toBe(true);
  });

  it('accepts an ordinary institutional address', () => {
    expect(accepts('afct@your-university.edu')).toBe(true);
  });

  it('accepts empty, meaning not configured', () => {
    expect(accepts('')).toBe(true);
  });

  it('still rejects something that is not an address at all', () => {
    expect(accepts('not-an-address')).toBe(false);
    expect(accepts('two@at@signs')).toBe(false);
    expect(accepts('spaces in@address')).toBe(false);
  });

  // The point of relaxing it was better failure messages, not silence.
  it('says what a valid address looks like when it rejects one', () => {
    const result = fromAddress.safeParse('nope');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toMatch(/afct@your-university\.edu/);
    }
  });
});

describe('the port', () => {
  const port = SmtpSettingsSchema.shape.smtpPort;

  it('accepts the two ports people actually use', () => {
    expect(port.safeParse(587).success).toBe(true);
    expect(port.safeParse(465).success).toBe(true);
  });

  it('rejects a port outside the legal range', () => {
    expect(port.safeParse(0).success).toBe(false);
    expect(port.safeParse(70000).success).toBe(false);
  });
});

describe('the test-message recipient', () => {
  it('requires an address', () => {
    expect(SendTestEmailSchema.safeParse({ to: '' }).success).toBe(false);
  });

  it('accepts one', () => {
    expect(SendTestEmailSchema.safeParse({ to: 'admin@example.edu' }).success).toBe(true);
  });
});
