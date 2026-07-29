import type { CodeAndUsers, FileStatusReturn } from "./types";
import { get_info_from_hash } from "./get_info_from_hash";

/* 
Checks the plagiarism status of a file based on the given file hash and the calculated hash
    params:
        fileHash: The hash located in the file
        fileUserId: The file's listed ID of the user who submitted the file
        calcHash: The hash calculated for the file (minus the info field)
        user_id: The ID of the user submitting the file
    returns:
        file_hash_user_code: 0-2 | undefined (0: only user submitted file; 1: no user submitted file; 2: atleast one other user submitted file; undefined: no file hash provided)
        calc_hash_user_code: 0-2 (0: only user submitted file; 1: no user submitted file; 2: atleast one other user submitted file)
        has_file_hash_code: boolean (true: file hash provided; false: no file hash provided)
        has_file_id_code: boolean (true: file ID provided; false: no file ID provided)
        hash_match_code: boolean | undefined (true: file hash matches; false: file hash does not match; undefined: no file hash provided)
        id_match_code: boolean | undefined (true: file ID matches; false: file ID does not match; undefined: no file ID provided)
        file_hash_user_ids: string[] (list of user IDs that submitted the file with the same hash)
        calc_hash_user_ids: string[] (list of user IDs that submitted the file with the same calculated hash)
        file_hash_submission_ids: string[] (list of submission IDs that submitted the file with the same hash)
        calc_hash_submission_ids: string[] (list of submission IDs that submitted the file with the same calculated hash)
*/
export async function check_file_status(oldHash: string | undefined, newHash: string | undefined, fileUserId: string | undefined, user_id: string): Promise<FileStatusReturn> {
    if (newHash === undefined) {
        throw new Error('Calculated hash is undefined. Cannot check file status without a calculated hash.');
    }
    
    const file_hash_user: CodeAndUsers = await get_info_from_hash(oldHash, user_id);
    const calc_hash_user: CodeAndUsers = await get_info_from_hash(newHash, user_id);

    return {
        file_hash_user_code: file_hash_user.code,
        calc_hash_user_code: calc_hash_user.code,

        has_file_hash_code: oldHash !== undefined,
        has_file_id_code: fileUserId !== undefined,

        hash_match_code: oldHash !== undefined ? oldHash === newHash : null,
        id_match_code: fileUserId !== undefined ? fileUserId === user_id : null,

        file_hash_user_ids: file_hash_user.ids.user_ids,
        calc_hash_user_ids: calc_hash_user.ids.user_ids,

        file_hash_submission_ids: file_hash_user.ids.submission_ids,
        calc_hash_submission_ids: calc_hash_user.ids.submission_ids,
    }
}