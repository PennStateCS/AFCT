import type { FileStatusReturn } from "./types";

/* 
Checks the plagiarism status of a file based on the given file hash and the calculated hash
    params:
        fileHash: The hash located in the file
        fileUserId: The file's listed ID of the user who submitted the file
        calcHash: The hash calculated for the file (minus the info field)
        user_id: The ID of the user submitting the file
    returns:
        file_hash_user_code: 0-2 (undefined if no file hash is provided)
        calc_hash_user_code: 0-2
        file_hash_code: true if file hash is given
        file_id_code: true if file user ID is given
        file_hash_match_code: true if file hash matches the calculated hash (undefined if no file hash is provided)
        file_id_match_code: true if file user ID matches the submitting user ID (undefined if no file id is provided)
        file_hash_user_ids: The user IDs of users who have submitted files with the same hash
        calc_hash_user_ids: The user IDs of users who have submitted files with the same calculated hash
        file_hash_submission_ids: The submission IDs of users who have submitted files with the same hash
        calc_hash_submission_ids: The submission IDs of users who have submitted files with the same calculated hash
*/
function check_file_status(oldHash: string | undefined, newHash: string, fileUserId: string | undefined, user_id: string): FileStatusReturn {
    return {
        file_hash_user_code: file_hash_user_code.code,
        calc_hash_user_code: calc_hash_user_code.code,

        file_hash_code: oldHash !== undefined,
        file_id_code: fileUserId !== undefined,

        file_hash_match_code: oldHash !== undefined ? oldHash === newHash : undefined,
        file_id_match_code: fileUserId !== undefined ? fileUserId === user_id : undefined,

        file_hash_user_ids: file_hash_user_code.ids.user_ids,
        calc_hash_user_ids: calc_hash_user_code.ids.user_ids,

        file_hash_submission_ids: file_hash_user_code.ids.submission_ids,
        calc_hash_submission_ids: calc_hash_user_code.ids.submission_ids,
    }
}