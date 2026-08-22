import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

type FeedbackDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  feedbackText?: string | null;
  title?: string;
  description?: string;
};

export function FeedbackDialog({
  open,
  onOpenChange,
  feedbackText,
  title = 'Feedback',
  description = 'Review the submission feedback below.',
}: FeedbackDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl p-0">
        <DialogHeader className="px-6 pt-6">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {/* Focusable so it can be scrolled by keyboard: the body holds nothing tabbable, so
            without a focus stop of its own a long counterexample was readable only with a
            mouse. Named so the stop means something when it is announced. */}
        <div
          className="text-foreground max-h-[60vh] overflow-auto px-6 py-5 text-base leading-relaxed"
          tabIndex={0}
          role="group"
          aria-label="Feedback"
        >
          {feedbackText ? feedbackText : 'No feedback available.'}
        </div>
        <DialogFooter className="px-6 pt-2 pb-6">
          <DialogClose asChild>
            <Button
              variant="secondary"
              type="button"
              className="h-10 rounded-md px-4 py-2 text-sm font-medium"
            >
              Close
            </Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
