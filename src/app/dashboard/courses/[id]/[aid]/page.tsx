"use client";
import { DataTable } from "@/components/ui/data-table";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuTrigger,
	DropdownMenuContent,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { ChevronDown, Pencil, Trash2, BookOpen, FileQuestion } from "lucide-react";
import { useParams, useSearchParams, useRouter } from "next/navigation";
import { useEffect, useState, useCallback } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { AssociateProblemsDialog } from "@/components/dialogs/AssociateProblemsDialog";
import { ConfirmDialog } from "@/components/dialogs/ConfirmDialog";
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
	DialogDescription,
	DialogClose,
} from '@/components/ui/dialog';
import { showToast } from "@/lib/toast";
import { EditAssignmentDialog } from "@/components/dialogs/EditAssignmentDialog";
import { EditProblemDialog } from "@/components/dialogs/EditProblemDialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import AssignmentSubmissions from "@/components/AssignmentSubmissions";
import Link from 'next/link';
import { Problem } from "@prisma/client";

const problemTypeLabels: Record<string, string> = {
	// Add your problem type labels here
};

type AssignmentWithDetails = {
	id: string;
	title: string;
	description?: string | null;
	courseId: string;
	courseName?: string;
	courseCode?: string;
	dueDate: string | Date;
	maxPoints: number;
	isPublished: boolean;
	createdAt?: Date;
	updatedAt?: Date;
	problems: Array<{ problem: Problem }>;
	course?: {
		id: string;
		name: string;
		code?: string;
	};
};

export default function AssignmentDashboardPage() {
	const { id, aid } = useParams<{ id: string; aid: string }>();
	const searchParams = useSearchParams();
	const router = useRouter();

		// Use a more flexible type for assignment to allow course details if available
		const [assignment, setAssignment] = useState<AssignmentWithDetails | null>(null);
	const [allProblems, setAllProblems] = useState<Problem[]>([]);
	const [problemsLoading, setProblemsLoading] = useState(false);
	const [problemToRemove, setProblemToRemove] = useState<Problem | null>(null);
	const [editAssignmentOpen, setEditAssignmentOpen] = useState(false);
	const [addProblemDialogOpen, setAddProblemDialogOpen] = useState(false);
	const [editProblemDialogOpen, setEditProblemDialogOpen] = useState(false);
	const [problemToEdit, setProblemToEdit] = useState<Problem | null>(null);
	const [loading, setLoading] = useState(false);
	const [tab, setTab] = useState(searchParams.get("tab") || "problems");
	const [descOpen, setDescOpen] = useState(false);
	const [descText, setDescText] = useState<string | null>(null);

	const openDescription = (text: string | null) => {
		setDescText(text);
		setDescOpen(true);
	};

	const handleTabChange = useCallback(
		(value: string) => {
			setTab(value);
			const params = new URLSearchParams(searchParams.toString());
			params.set("tab", value);
			router.replace(`?${params.toString()}`);
		},
		[searchParams, router]
	);

	useEffect(() => {
		if (!id) return;
		setProblemsLoading(true);
		fetch(`/api/courses/${id}/problems`)
			.then((res) => res.json())
			.then((data) => setAllProblems(Array.isArray(data) ? data : []))
			.catch(() => setAllProblems([]))
			.finally(() => setProblemsLoading(false));
	}, [id]);

	useEffect(() => {
		if (!aid) return;
		setLoading(true);
		fetch(`/api/courses/${id}/${aid}`)
			.then((res) => res.json())
			.then((data) => setAssignment(data))
			.catch(() => setAssignment(null))
			.finally(() => setLoading(false));
	}, [id, aid]);

	async function handleAddProblems(problemIds: string[]) {
		if (!id || !aid) return;
		try {
			const res = await fetch(`/api/courses/${id}/${aid}/add-problems`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ problemIds }),
			});
			if (!res.ok) throw new Error();
			showToast.success("Problems added");
		} catch {
			showToast.error("Failed to add problems");
		}
		setLoading(true);
		fetch(`/api/courses/${id}/${aid}`)
			.then((res) => res.json())
			.then((data) => setAssignment(data))
			.finally(() => setLoading(false));
	}

	async function handleConfirmRemoveProblem() {
		if (!id || !aid || !problemToRemove) return;
		try {
			const res = await fetch(`/api/courses/${id}/${aid}/remove-problem`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ problemId: problemToRemove.id }),
			});
			if (!res.ok) throw new Error();
			showToast.success(`"${problemToRemove.title}" removed from assignment`);
		} catch {
			showToast.error(`Failed to remove "${problemToRemove.title}"`);
		}
		setLoading(true);
		fetch(`/api/courses/${id}/${aid}`)
			.then((res) => res.json())
			.then((data) => setAssignment(data))
			.finally(() => {
				setProblemToRemove(null);
				setLoading(false);
			});
	}

	const handleEditAssignment = () => setEditAssignmentOpen(true);
	const handleAddExistingProblem = () => setAddProblemDialogOpen(true);
	const handleEditProblem = (problem: Problem) => {
		const problemWithCourseId = {
			...problem,
			courseId: id,
		};
		setProblemToEdit(problemWithCourseId);
		setEditProblemDialogOpen(true);
	};

	if (loading) return <div className="p-6">Loading assignment...</div>;
		if (!assignment) return <div className="p-6 text-red-500">Assignment not found.</div>;

	return (
			<div className="mx-auto w-full text-sm">
				<div className="bg-card relative mb-8 w-full space-y-6 rounded-lg border p-6 shadow">
					<Button
						variant="default"
						aria-label="Edit Assignment"
						onClick={handleEditAssignment}
						className="absolute right-6 top-6"
					>
						Edit Assignment
					</Button>
					<div>
						<h1 className="text-2xl">
							<span className="font-semibold">Assignment:</span> {assignment.title}
						</h1>
						<div className="text-muted-foreground mt-1 text-sm flex flex-wrap items-center gap-2">
							{/* Show course name/code as a link to the course page (fallback to courseId) */}
							<Link
								href={`/dashboard/courses/${assignment.course?.id || assignment.courseId}`}
								className="text-blue-700 hover:underline"
							>
								{assignment.course?.name || assignment.courseName || assignment.courseId}
								{assignment.course?.code ? ` (${assignment.course.code})` : assignment.courseCode ? ` (${assignment.courseCode})` : ""}
							</Link>
							<span className="text-muted-foreground">•</span>
							{assignment.isPublished ? (
								<span className="font-semibold text-green-600">Published</span>
							) : (
								<span className="font-semibold text-yellow-500">Unpublished</span>
							)}
							<span className="text-muted-foreground">•</span>
							<span className="text-sm"><span className="font-semibold">Max Points:</span> {assignment.maxPoints}</span>
							<span className="text-muted-foreground">•</span>
							<span className="text-sm"><span className="font-semibold">Due:</span> {new Date(assignment.dueDate).toLocaleString()}</span>
						</div>
					</div>
					<div>
						<span className="font-semibold">Description:</span>
						<br /> {assignment.description ?? 'No description.'}
					</div>
				</div>
			<Tabs value={tab} onValueChange={handleTabChange}>
				<TabsList className="bg-card border-border h-12 rounded-md border p-1 shadow-sm">
					<TabsTrigger
						className="data-[state=active]:bg-secondary w-50 data-[state=active]:text-white"
						value="problems"
					>
						Problems
					</TabsTrigger>
					<TabsTrigger
						className="data-[state=active]:bg-secondary w-50 data-[state=active]:text-white"
						value="submissions"
					>
					Submissions
					</TabsTrigger>
				</TabsList>
				<TabsContent
					value="problems"
					className="animate-fade-in-up transition-opacity duration-300"
				>
					<Card className="w-full">
						<CardHeader className="text-2xl">
							<div className="flex items-center justify-between w-full">
								<CardTitle  className="flex items-center gap-2 text-2xl"><FileQuestion className="w-6 h-6" />Problems</CardTitle>
								<Button
									variant="default"
									aria-label="Add Existing Problem"
									onClick={handleAddExistingProblem}
									disabled={problemsLoading}
								>
									Add Existing Problem
								</Button>
							</div>
							<p className="mt-2 text-muted-foreground text-sm">
								This assignment is made up of the following problems. You can add an existing problem from this course by clicking on the <strong>Add Existing Problem</strong> button in the upper right hand corner.
							</p>
						</CardHeader>
						<CardContent>
							<DataTable
												columns={[
													{
														id: 'number',
														header: '#',
														cell: ({ row }: { row: { index: number } }) => row.index + 1,
														meta: { priority: 1 },
														enableSorting: false,
													},
													{
														accessorKey: 'title',
														header: 'Title',
														cell: ({ row }: { row: { original: Problem } }) => row.original.title,
														meta: { priority: 1 },
														enableSorting: true,
													},
													{
														id: 'description_col',
														header: 'Description',
														cell: ({ row }: { row: { original: Problem } }) => {
															const desc = row.original.description;
															return desc ? (
																<button
																	type="button"
																	onClick={() => openDescription(desc)}
																	className="text-blue-600 underline hover:text-blue-800"
																	title="View description"
																>
																	View
																</button>
															) : (
																<span className="text-muted-foreground text-xs">—</span>
															);
														},
														meta: { priority: 2 },
														enableSorting: false,
													},
													{
														accessorKey: 'type',
														header: 'Type',
														cell: ({ row }: { row: { original: Problem } }) => problemTypeLabels[row.original.type as string] || row.original.type,
														meta: { priority: 1 },
														enableSorting: true,
													},
													{
														accessorKey: 'maxStates',
														header: 'Max States',
														cell: ({ row }: { row: { original: Problem } }) => row.original.maxStates === -1 ? 'Unlimited' : row.original.maxStates,
														meta: { priority: 2 },
														enableSorting: true,
													},
													{
														accessorKey: 'isDeterministic',
														header: 'Deterministic',
														cell: ({ row }: { row: { original: Problem } }) => row.original.isDeterministic ? 'Yes' : 'No',
														meta: { priority: 2 },
														enableSorting: true,
													},
																		{
																			id: 'answerFile',
																			header: 'Answer File',
																			cell: ({ row }: { row: { original: Problem } }) => {
																				// Problem solution files are stored under public/uploads/solutions
																				const fileUrl = row.original.fileName ? `/api/solutions/${row.original.fileName}` : null;
																				const fileName = row.original.originalFileName || 'Download';
																				return fileUrl ? (
																					<a
																						href={fileUrl}
																						download={fileName}
																						className="text-blue-600 underline hover:text-blue-800"
																						target="_blank"
																						rel="noopener noreferrer"
																					>
																						{fileName}
																					</a>
																				) : (
																					<span className="text-muted-foreground">No file</span>
																				);
																			},
																			meta: { priority: 2 },
																			enableSorting: false,
																		},
																	{
																		id: 'actions',
																		header: 'Actions',
																		cell: ({ row }: { row: { original: Problem } }) => (
																			<DropdownMenu>
																				<DropdownMenuTrigger asChild>
																					<Button variant="secondary" size="sm">
																						<ChevronDown className="mr-1 h-4 w-4" /> Manage
																					</Button>
																				</DropdownMenuTrigger>
																				<DropdownMenuContent align="end">
																					<DropdownMenuLabel className="flex items-center gap-2">
																						<BookOpen className="h-4 w-4" />
																						{row.original.title}
																					</DropdownMenuLabel>
																					<DropdownMenuSeparator />
																					<DropdownMenuItem
																						onClick={() => handleEditProblem(row.original)}
																						className="hover:bg-secondary focus:bg-secondary flex items-center gap-2"
																					>
																						<Pencil className="mr-2 h-4 w-4" /> Edit Problem
																					</DropdownMenuItem>
																					<DropdownMenuSeparator />
																					<DropdownMenuItem
																						onClick={() => setProblemToRemove(row.original)}
																						className="hover:bg-secondary focus:bg-secondary flex items-center gap-2 text-red-600"
																					>
																						<Trash2 className="mr-2 h-4 w-4" /> Remove Problem
																					</DropdownMenuItem>
																				</DropdownMenuContent>
																			</DropdownMenu>
																		),
																		meta: { priority: 1 },
																	},
												]}
																	data={assignment.problems.map((ap: { problem: Problem }) => ({
																		...ap.problem,
																		description: ap.problem.description ?? null,
																	}))}
							/>
						</CardContent>
					</Card>
				</TabsContent>
				<TabsContent value="submissions">
					<AssignmentSubmissions
						courseId={id}
						assignmentId={aid}
						problems={assignment.problems.map((ap: { problem: Problem }) => ({
							id: ap.problem.id,
							title: ap.problem.title,
							description: ap.problem.description ?? undefined,
							type: ap.problem.type ? String(ap.problem.type) : undefined,
							maxStates: ap.problem.maxStates ?? undefined,
							isDeterministic: ap.problem.isDeterministic ?? undefined
						}))}
					/>
				</TabsContent>
			</Tabs>
			{/* Description dialog */}
			<Dialog open={descOpen} onOpenChange={(v) => setDescOpen(v)}>
				<DialogContent className="bg-white">
					<DialogHeader>
						<DialogTitle>Problem Description</DialogTitle>
					</DialogHeader>
					<DialogDescription>
						{descText ?? 'No description.'}
					</DialogDescription>
					<DialogClose asChild>
						<Button variant="secondary">Close</Button>
					</DialogClose>
				</DialogContent>
			</Dialog>
			<AssociateProblemsDialog
				open={addProblemDialogOpen}
				onClose={() => setAddProblemDialogOpen(false)}
				allProblems={allProblems.map((p: Problem) => ({
					...p,
					description: p.description ?? undefined,
					type: typeof p.type === 'string' ? p.type : undefined,
				}))}
				usedProblems={assignment.problems.map((ap: { problem: Problem }) => ({
					...ap.problem,
					description: ap.problem.description ?? undefined,
					type: typeof ap.problem.type === 'string' ? ap.problem.type : undefined,
				}))}
				onAddProblems={handleAddProblems}
			/>
			<ConfirmDialog
				open={!!problemToRemove}
				title="Remove Problem from Assignment"
				description={problemToRemove ? `Are you sure you want to remove "${problemToRemove.title}" from this assignment?` : undefined}
				confirmText="Remove"
				cancelText="Cancel"
				onConfirm={handleConfirmRemoveProblem}
				onCancel={() => setProblemToRemove(null)}
			/>
			{assignment && (
				<EditAssignmentDialog
					open={editAssignmentOpen}
					setOpen={setEditAssignmentOpen}
					assignment={{
						...assignment,
						description: assignment.description ?? null,
						createdAt: assignment.createdAt ?? new Date(),
						updatedAt: assignment.updatedAt ?? new Date(),
						dueDate: typeof assignment.dueDate === 'string' ? new Date(assignment.dueDate) : assignment.dueDate
					}}
					onSave={() => {
						setLoading(true);
						fetch(`/api/courses/${id}/${aid}`)
							.then((res) => res.json())
							.then((data) => setAssignment(data))
							.finally(() => setLoading(false));
					}}
				/>
			)}
			{problemToEdit && (
				<EditProblemDialog
					open={editProblemDialogOpen}
					setOpen={setEditProblemDialogOpen}
					problem={problemToEdit ? {
						...problemToEdit,
						description: problemToEdit.description ?? null,
						// Preserve string type when present so FA/PDA fields render
						type: typeof problemToEdit.type === 'string' ? problemToEdit.type : null,
						maxStates: problemToEdit.maxStates ?? null,
						isDeterministic: (problemToEdit as Problem & { isDeterministic?: boolean }).isDeterministic ?? null,
					} : {
						id: '',
						title: '',
						description: null,
						fileName: null,
						originalFileName: null,
						type: null,
						maxStates: null,
						isDeterministic: null,
						createdAt: new Date(),
						updatedAt: new Date(),
						courseId: '',
					}}
					onSaved={() => {
						setLoading(true);
						fetch(`/api/courses/${id}/${aid}`)
							.then((res) => res.json())
							.then((data) => setAssignment(data))
							.finally(() => setLoading(false));
					}}
				/>
			)}
		</div>
	);
}
