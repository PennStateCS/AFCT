export type CodeAndUsers = {
    code: number | null;
    ids: {
        user_ids: string[];
        submission_ids: string[];
    }
};

export type FileStatusReturn = {
    file_hash_code: number | null; // 0-2 (null if no file hash is provided)
    calc_hash_code: number | null; // 0-2 (technically cannot be null, but marked for type consistency for no errors)

    file_hash_email: string | null;
    calc_hash_email: string | null; // technically cannot be null, but could be on DB error

    is_user_hash: boolean | null; // true if file user ID matches the submitting user ID (null if no file id is provided)

    hash_data_match: boolean | null; // true if file hash data matches the calculated hash data (null if no file hash data is provided)
    hash_email_match: boolean | null; // true if file hash useremail matches the submitting hash useremail (null if no file hash email is provided)

    file_hash_user_ids: string[];
    calc_hash_user_ids: string[];

    file_hash_submission_ids: string[];
    calc_hash_submission_ids: string[];
};

export interface JflapSimilarityData {
  fileHashEmail: string | undefined;
  fileHashData: string | undefined;
  calcHashData: string | undefined;
}
