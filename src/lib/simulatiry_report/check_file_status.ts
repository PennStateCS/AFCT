import type { CodeAndUsers, FileStatusReturn } from "./types";
import { createHash } from "crypto";
import { get_info_from_hash } from "./get_info_from_hash";
import { prisma } from "../prisma";

/* 
Checks the plagiarism status of a file based on the given file hash and the calculated hash
    params:
        oldHash: The hash located in the file
        newHash: The calculated hash of the file
        fileUserId: The file user ID of the user who submitted the file
        user_id: The user ID of the user who is checking the file status
    returns:
        file_hash_code: 0-2 | null (0: nobody submitted this file; 1: only this user submitted it; 2: at least one other user submitted it; null: no file hash provided)
        calc_hash_code: 0-2 | null (same three codes; see get_info_from_hash, which is what sets them)

        NOTE: 0 and 1 were documented the wrong way round here until 2026-08-14. Anyone reading a
        stored report against the old wording would have read "nobody submitted this" as "only
        this student did", which is the opposite conclusion about a plagiarism check.
        file_hash_email: boolean | null
        calc_hash_email: boolean | null
        is_user_hash: boolean | null (true: file user email hashes match; false: file user email hashes does not match; undefined: no file ID provided)
        hash_data_match: boolean | null (true: file hash matches; false: file hash does not match; undefined: no file hash provided)
        hash_email_match: boolean | null (true: file hash email matches the calculated hash email; false: file hash email does not match the calculated hash email; undefined: no file hash email is provided)
        file_hash_user_ids: string[] (list of user IDs that submitted the file with the same hash)
        calc_hash_user_ids: string[] (list of user IDs that submitted the file with the same calculated hash)
        file_hash_submission_ids: string[] (list of submission IDs that submitted the file with the same hash)
        calc_hash_submission_ids: string[] (list of submission IDs that submitted the file with the same calculated hash)
*/
export async function check_file_status(fileHashData: string | undefined, calcHashData: string | undefined, fileHashEmail: string | undefined, user_id: string): Promise<FileStatusReturn> {
    if (calcHashData === undefined) {
        throw new Error('Calculated hash is undefined. Cannot check file status without a calculated hash.');
    }

    const file_hash_user: CodeAndUsers = await get_info_from_hash(fileHashData, user_id);
    const calc_hash_user: CodeAndUsers = await get_info_from_hash(calcHashData, user_id);

    const calcHashEmail = await prisma.user.findUnique({ where: { id: user_id } })
        .then(user => user?.email)
        .then(email => {
            const trimmedEmail = email?.trim();
            return trimmedEmail ? createHash("sha256").update(trimmedEmail).digest("hex") : null;
        });

    return {
        file_hash_code: file_hash_user.code,
        calc_hash_code: calc_hash_user.code,

        file_hash_email: fileHashEmail !== undefined ? fileHashEmail : null,
        calc_hash_email: calcHashEmail,

        is_user_hash: fileHashEmail !== undefined
            ? fileHashEmail === calcHashEmail
            : null,

        hash_data_match: fileHashData !== undefined ? fileHashData === calcHashData : null,
        hash_email_match: fileHashEmail !== undefined ? fileHashEmail === calcHashEmail : null,

        file_hash_user_ids: file_hash_user.ids.user_ids,
        calc_hash_user_ids: calc_hash_user.ids.user_ids,

        file_hash_submission_ids: file_hash_user.ids.submission_ids,
        calc_hash_submission_ids: calc_hash_user.ids.submission_ids,
    }
}