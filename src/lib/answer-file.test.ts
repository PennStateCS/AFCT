import { describe, it, expect } from 'vitest';
import { answerFileRejection, ANSWER_FILE_EXTENSIONS, ANSWER_FILE_HINT } from './answer-file';

/**
 * The rule the two problem wizards share: the extension is wide open, the contents are not.
 * Reported as #791, where a plain .txt was refused with nothing said about why.
 */
describe('answerFileRejection', () => {
  it('accepts a JFLAP model of the matching type', () => {
    expect(answerFileRejection('<structure><type>FA</type></structure>', 'FA')).toBeNull();
  });

  it('accepts leading whitespace and an XML declaration', () => {
    const text = '\n  <?xml version="1.0"?><structure><type>FA</type></structure>';
    expect(answerFileRejection(text, 'FA')).toBeNull();
  });

  it('rejects plain text, whatever it is called', () => {
    // The reported case: a .txt is offered by the picker because JFLAP saves under that
    // extension too, so the refusal has to be about the contents.
    const message = answerFileRejection('q0 -> q1 on a', 'FA');
    expect(message).toMatch(/not a JFLAP model/i);
    expect(message).toMatch(/save/i);
  });

  it('names both types when the structure is the wrong one', () => {
    const message = answerFileRejection('<structure><type>PDA</type></structure>', 'FA');
    expect(message).toContain('PDA');
    expect(message).toContain('FA');
    // Worded for every caller: the sandbox has a selected type but no problem.
    expect(message).not.toMatch(/problem type/i);
  });

  it('maps the two types JFLAP spells differently', () => {
    // JFLAP writes GRAMMAR for a CFG and TURING for a TM, so a correct file would otherwise
    // be refused as a mismatch.
    expect(answerFileRejection('<structure><type>GRAMMAR</type></structure>', 'CFG')).toBeNull();
    expect(answerFileRejection('<structure><type>TURING</type></structure>', 'TM')).toBeNull();
  });

  it('accepts XML that declares no type at all', () => {
    // Nothing to disagree with. The evaluator is the real judge of a malformed model.
    expect(answerFileRejection('<structure></structure>', 'FA')).toBeNull();
  });

  it('offers .txt among the extensions, which is what made the silence confusing', () => {
    expect(ANSWER_FILE_EXTENSIONS).toContain('.txt');
  });

  it('leads the hint with the requirement, not the extension list', () => {
    // The list alone reads as a promise that any .txt will do, which is the expectation #791
    // was filed against.
    expect(ANSWER_FILE_HINT).toMatch(/saved from JFLAP/i);
    expect(ANSWER_FILE_HINT).toContain('.txt');
  });
});
