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
      <DialogContent className="bg-card max-w-xl p-0">
        <DialogHeader className="px-6 pt-6">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">
            {description}
          </DialogDescription>
        </DialogHeader>
        <div className="max-h-[60vh] overflow-auto px-6 py-5 text-base leading-relaxed text-slate-900">
          {feedbackText ? feedbackText : 'No feedback available.'}
        </div>
        <DialogFooter className="px-6 pb-6 pt-2">
          <DialogClose asChild>
            <Button variant="secondary" type="button" className="h-10 rounded-md px-4 py-2 text-sm font-medium">
              Close
            </Button>
          </DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
