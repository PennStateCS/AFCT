import { describe, expect, it } from 'vitest';
import { namesForReview, type RosterUser } from './useFacultyTaOptions';

const person = (id: string, firstName: string, lastName: string, email: string) =>
  ({ id, firstName, lastName, email }) as RosterUser;

const people = [
  person('b1', 'Bruce', 'Wayne', 'bwayne@example.edu'),
  person('b2', 'Bruce', 'Wayne', 'bruce.wayne@example.edu'),
  person('c1', 'Clark', 'Kent', 'ckent@example.edu'),
];

/**
 * The review step of the course wizards.
 *
 * The picker shows every email, because that is where somebody chooses. This line is a summary,
 * so it spends the space only where the name alone would not say who was chosen.
 */
describe('namesForReview', () => {
  it('names people by name when the names are distinct', () => {
    expect(namesForReview(['b1', 'c1'], people)).toBe('Bruce Wayne, Clark Kent');
  });

  it('adds the email to both where a name is chosen twice', () => {
    expect(namesForReview(['b1', 'b2', 'c1'], people)).toBe(
      'Bruce Wayne (bwayne@example.edu), Bruce Wayne (bruce.wayne@example.edu), Clark Kent',
    );
  });

  it('keeps an id nobody matches, which is at least traceable', () => {
    expect(namesForReview(['b1', 'ghost'], people)).toBe('Bruce Wayne, ghost');
  });

  it('answers with nothing for an empty selection, so a caller can fall back', () => {
    expect(namesForReview([], people)).toBe('');
  });
});
