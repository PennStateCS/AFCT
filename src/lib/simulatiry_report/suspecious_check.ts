import type { SimilarityReportJsonData } from './types';
import type { SuspeciousCheckResult } from './types';

export function suspeciousCheck(similarityReportJson: SimilarityReportJsonData): SuspeciousCheckResult {
  // Suspecious variable declaration
  let isSuspicious: boolean = false;
  let isSuspiciousOverride: boolean | null = null;
  const isSuspiciousReasonParts: string[] = [];

  // Perform suspicious check based on the similarity report JSON data
  // Matching data hashes that match other user(s)
  if (similarityReportJson.hash_data_match === true && similarityReportJson.file_hash_code == 2) { // Codes will be the same; we can just check one
    isSuspicious = true;
    isSuspiciousReasonParts.push('Data hashes match and match other user(s).');
  }

  // Non matching data hashes but file data hash match other user(s)
  if (similarityReportJson.hash_data_match === false && similarityReportJson.file_hash_code == 2) {
    isSuspicious = true;
    isSuspiciousReasonParts.push('Data hashes do not match but file hash code match other user(s).');
  }

  // Non matching data hashes but calc data hash match other user(s)
  if (similarityReportJson.hash_data_match === false && similarityReportJson.calc_hash_code == 2) {
    isSuspicious = true;
    isSuspiciousReasonParts.push('Data hashes do not match but calculated hash code match other user(s).');
  }

  // File user hash does not match user
  if (similarityReportJson.hash_email_match === false && similarityReportJson.is_user_hash === false) {
    isSuspicious = true;
    isSuspiciousReasonParts.push('File user hash does not match the user.');
  }

  // Only the file data hash is missing (altercation)
  if (similarityReportJson.file_hash_code === null && similarityReportJson.file_hash_email !== null) {
    isSuspicious = true;
    isSuspiciousReasonParts.push('The file data hash is missing, but the file hash email is present. The file was altered.');
  }

  // Only the file hash email is missing (altercation)
  if (similarityReportJson.file_hash_code !== null && similarityReportJson.file_hash_email === null) {
    isSuspicious = true;
    isSuspiciousReasonParts.push('The file hash email is missing, but the file data hash is present. The file was altered.');
  }

  const isSuspiciousReason = isSuspiciousReasonParts.length
    ? isSuspiciousReasonParts.join('\n')
    : null;

  return { isSuspicious, isSuspiciousOverride, isSuspiciousReason };
}