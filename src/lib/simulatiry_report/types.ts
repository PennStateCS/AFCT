export type CodeAndUsers = {
    code: number | null;
    ids: {
        user_ids: string[];
        submission_ids: string[];
    }
};

export type FileStatusReturn = {
    file_hash_user_code: number | null; // 0-2 (null if no file hash is provided)
    calc_hash_user_code: number | null; // 0-2 (technically cannot be null, but marked for type consistency for no errors)

    has_file_hash_code: boolean; // true if file hash is given
    has_file_id_code: boolean; // true if file user ID is given

    hash_match_code: boolean | null; // true if file hash matches the calculated hash (null if no file hash is provided)
    id_match_code: boolean | null; // true if file user ID matches the submitting user ID (null if no file id is provided)

    file_hash_user_ids: string[];
    calc_hash_user_ids: string[];

    file_hash_submission_ids: string[];
    calc_hash_submission_ids: string[];
};
