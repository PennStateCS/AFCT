import { describe, expect, it } from 'vitest';
import { databaseNameFrom, mayPrune } from './seed-dev-extras';

/**
 * Whose uploaded files the dev seed may delete.
 *
 * This is the rule that cost a development environment. The seed deletes uploaded files no row
 * points at, which is right for the database that owns the uploads directory and catastrophic
 * for any other: run the seed against a throwaway copy inside the dev container, where the
 * volume is shared, and every real file looks like an orphan. It deleted 754 submissions, every
 * solution file and every avatar, and left a database whose every file link answered "this file
 * is not there any more".
 *
 * The first attempt at a guard asked whether the database recognised any file already on disk.
 * That looked right and was not: the seed writes its own solution files and avatars before this
 * step runs, so it recognised those, decided the directory was its own, and deleted the rest.
 * Marking the directory with its owner is the only version that tells the two cases apart.
 */
describe('who owns the uploads directory', () => {
  it('reads the database name out of the connection string', () => {
    expect(databaseNameFrom('postgresql://afct_user:pass@postgres:5432/afct')).toBe('afct');
    expect(databaseNameFrom('postgresql://u:p@host:5432/afct_seedcheck?schema=public')).toBe(
      'afct_seedcheck',
    );
  });

  it('answers nothing for a connection string it cannot read', () => {
    expect(databaseNameFrom(undefined)).toBeNull();
    expect(databaseNameFrom('not a url')).toBeNull();
  });

  it('claims a directory nobody has claimed', () => {
    expect(mayPrune(null, 'afct')).toBe(true);
  });

  it('prunes a directory this database already owns', () => {
    expect(mayPrune('afct', 'afct')).toBe(true);
  });

  it('leaves the files of another database alone', () => {
    // The case that did the damage.
    expect(mayPrune('afct', 'afct_seedcheck')).toBe(false);
  });

  it('deletes nothing when it cannot tell which database it is', () => {
    expect(mayPrune('afct', null)).toBe(false);
    expect(mayPrune(null, null)).toBe(false);
  });
});
