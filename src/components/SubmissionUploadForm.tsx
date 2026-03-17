'use client';

import { useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import FileUploadInput from '@/components/FileUploadInput';
import { useMaxUploadSize } from '@/hooks/useMaxUploadSize';
import { showToast } from '@/lib/toast';
import { Upload, AlertCircle } from 'lucide-react';

export type SubmissionUploadFormProps = {
  courseId: string;
  assignmentId: string;
  problemId: string;
  problemTitle: string;
  acceptedFormats: string; // e.g., ".jff,.fa,.pda,.cfg,.re,.txt"
  disabled?: boolean;
  onSubmitSuccess?: () => void;
  onSubmitError?: (error: string) => void;
};

export default function SubmissionUploadForm({
  courseId,
  assignmentId,
  problemId,
  problemTitle,
  acceptedFormats,
  disabled = false,
  onSubmitSuccess,
  onSubmitError,
}: SubmissionUploadFormProps) {
  const { maxMb, loading: loadingMaxSize } = useMaxUploadSize();
  const [file, setFile] = useState<File | undefined>(undefined);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleFileChange = useCallback((newFile: File | undefined) => {
    setFile(newFile);
  }, []);

  const handleSubmit = async () => {
    if (!file) {
      showToast.error('Please select a file to submit.');
      onSubmitError?.('No file selected');
      return;
    }

    setIsSubmitting(true);

    try {
      const formData = new FormData();
      formData.append('courseId', courseId);
      formData.append('assignmentId', assignmentId);
      formData.append('problemId', problemId);
      formData.append('file', file);

      const res = await fetch('/api/submissions', {
        method: 'POST',
        body: formData,
        headers: {
          Authorization: `Bearer ${localStorage.getItem('token') || ''}`,
        },
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        const errorMessage =
          (errorData as { error?: string }).error ||
          `Server error: ${res.status} ${res.statusText}`;
        showToast.error(errorMessage);
        onSubmitError?.(errorMessage);
        return;
      }

      const result = await res.json();

      showToast.success('Solution submitted successfully!');
      setFile(undefined);
      onSubmitSuccess?.();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to submit solution';
      showToast.error(message);
      onSubmitError?.(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">Submit Solution</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-start gap-3 rounded-md border border-blue-200 bg-blue-50 p-3">
          <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-blue-600" />
          <p className="text-sm text-blue-900">
            Submit your solution file for <strong>{problemTitle}</strong>. You can submit multiple
            times; only your latest submission will be graded.
          </p>
        </div>

        <FileUploadInput
          id="submission-file"
          name="submissionFile"
          label="Solution File"
          accept={acceptedFormats}
          maxSizeMb={maxMb}
          value={file}
          onChange={handleFileChange}
          disabled={disabled || isSubmitting || loadingMaxSize}
          hint={`Supported formats: ${acceptedFormats.split(',').join(', ')}`}
          description="Drag and drop your file here or click to browse. Your latest submission will be graded."
        />

        <Button
          onClick={handleSubmit}
          disabled={!file || isSubmitting || loadingMaxSize || disabled}
          className="w-full"
          size="lg"
        >
          <Upload className="mr-2 h-4 w-4" />
          {isSubmitting ? 'Submitting...' : 'Submit Solution'}
        </Button>
      </CardContent>
    </Card>
  );
}
