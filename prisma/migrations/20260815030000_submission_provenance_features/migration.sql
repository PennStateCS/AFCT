-- A small description of each submitted artifact in pieces, so a copied file that has since
-- been edited can still be recognised. Neither existing hash can do that: both are
-- all-or-nothing. Read per problem when staff open the Similarity tab, never during grading.

ALTER TABLE "Submission" ADD COLUMN "provenanceFeatures" JSONB;
