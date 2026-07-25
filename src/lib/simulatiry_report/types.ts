export type CodeAndUsers = {
    code: number | undefined;
    user_ids: string[];
};

export type FileStatusReturn = {
    file_hash_user_code: number | undefined; // 0-2 (undefined if no file hash is provided)
    calc_hash_user_code: number | undefined; // 0-2 (technically cannot be undefined, but marked for type consistency for no errors)

    file_hash_code: boolean; // true if file hash is given
    file_id_code: boolean; // true if file user ID is given

    file_hash_match_code: boolean | undefined; // true if file hash matches the calculated hash (undefined if no file hash is provided)
    file_id_match_code: boolean | undefined; // true if file user ID matches the submitting user ID (undefined if no file id is provided)

    file_hash_user_ids: string[];
    calc_hash_user_ids: string[];
};
