import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { type ScheduledTaskListItem, api } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useDashboardAuth } from "@/routes/dashboard";
import { CaretRightIcon, PauseIcon, PlayIcon, SpinnerGapIcon, TrashIcon } from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createRoute } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { dashboardRoute } from "./dashboard";

export const scheduledTasksRoute = createRoute({
  getParentRoute: () => dashboardRoute,
  path: "/scheduled-tasks",
  component: ScheduledTasksPage,
});

const TASKS_QUERY_KEY = ["scheduled-tasks"];

function formatDateTime(value: string | null) {
  if (!value) return "Never";

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function getScheduledTasksSubtitle(role: "admin" | "member") {
  return role === "admin"
    ? "View and manage recurring and one-time tasks across the workspace"
    : "View and manage the tasks you created through chat";
}

function getFallbackTaskError(error: unknown) {
  return error instanceof Error && error.message ? error.message : "Failed to update scheduled task";
}

function replaceTaskInCache(
  tasks: ScheduledTaskListItem[] | undefined,
  updatedTask: ScheduledTaskListItem,
): ScheduledTaskListItem[] {
  if (!tasks) return [updatedTask];
  return tasks.map((task) => (task.id === updatedTask.id ? updatedTask : task));
}

function removeTaskFromCache(tasks: ScheduledTaskListItem[] | undefined, taskId: string): ScheduledTaskListItem[] {
  return (tasks ?? []).filter((task) => task.id !== taskId);
}

export function ScheduledTasksPage() {
  const auth = useDashboardAuth();
  const queryClient = useQueryClient();
  const [expandedTaskId, setExpandedTaskId] = useState<string | null>(null);
  const [deletingTask, setDeletingTask] = useState<ScheduledTaskListItem | null>(null);

  const tasksQuery = useQuery({
    queryKey: TASKS_QUERY_KEY,
    queryFn: () => api.scheduledTasks.list(),
  });

  const pauseMutation = useMutation({
    mutationFn: (taskId: string) => api.scheduledTasks.pause(taskId),
    onSuccess: (task) => {
      queryClient.setQueryData<ScheduledTaskListItem[]>(TASKS_QUERY_KEY, (tasks) => replaceTaskInCache(tasks, task));
      toast.success("Task paused");
    },
    onError: (error) => {
      toast.error(getFallbackTaskError(error));
    },
  });

  const resumeMutation = useMutation({
    mutationFn: (taskId: string) => api.scheduledTasks.resume(taskId),
    onSuccess: (task) => {
      queryClient.setQueryData<ScheduledTaskListItem[]>(TASKS_QUERY_KEY, (tasks) => replaceTaskInCache(tasks, task));
      toast.success("Task resumed");
    },
    onError: (error) => {
      toast.error(getFallbackTaskError(error));
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (taskId: string) => api.scheduledTasks.remove(taskId),
    onSuccess: (_result, taskId) => {
      queryClient.setQueryData<ScheduledTaskListItem[]>(TASKS_QUERY_KEY, (tasks) => removeTaskFromCache(tasks, taskId));
      setDeletingTask(null);
      setExpandedTaskId((current) => (current === taskId ? null : current));
      toast.success("Task deleted");
    },
    onError: (error) => {
      toast.error(getFallbackTaskError(error));
    },
  });

  const tasks = tasksQuery.data ?? [];
  const isAdmin = auth.role === "admin";

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <div>
        <h1 className="text-xl font-bold">Scheduled Tasks</h1>
        <p className="mt-1 text-sm text-muted-foreground">{getScheduledTasksSubtitle(auth.role)}</p>
      </div>

      <div className="mt-6">
        {tasksQuery.isLoading ? (
          <LoadingSkeleton />
        ) : tasksQuery.isError ? (
          <ErrorState />
        ) : tasks.length === 0 ? (
          <EmptyState />
        ) : (
          <>
            <p className="mb-3 text-sm font-medium text-muted-foreground">
              {isAdmin ? "All scheduled tasks" : "Your scheduled tasks"}
            </p>
            <div className="rounded-lg border border-border bg-card">
              {tasks.map((task, index) => (
                <TaskRow
                  key={task.id}
                  task={task}
                  isAdmin={isAdmin}
                  isExpanded={expandedTaskId === task.id}
                  isLast={index === tasks.length - 1}
                  isPausing={pauseMutation.isPending && pauseMutation.variables === task.id}
                  isResuming={resumeMutation.isPending && resumeMutation.variables === task.id}
                  isDeleting={deleteMutation.isPending && deleteMutation.variables === task.id}
                  onToggleExpanded={() => setExpandedTaskId((current) => (current === task.id ? null : task.id))}
                  onPause={() => pauseMutation.mutate(task.id)}
                  onResume={() => resumeMutation.mutate(task.id)}
                  onDelete={() => setDeletingTask(task)}
                />
              ))}
            </div>
          </>
        )}
      </div>

      <DeleteTaskDialog
        task={deletingTask}
        isDeleting={deleteMutation.isPending}
        onOpenChange={(open) => {
          if (!open) setDeletingTask(null);
        }}
        onConfirm={() => {
          if (deletingTask) {
            deleteMutation.mutate(deletingTask.id);
          }
        }}
      />
    </div>
  );
}

function TaskRow({
  task,
  isAdmin,
  isExpanded,
  isLast,
  isPausing,
  isResuming,
  isDeleting,
  onToggleExpanded,
  onPause,
  onResume,
  onDelete,
}: {
  task: ScheduledTaskListItem;
  isAdmin: boolean;
  isExpanded: boolean;
  isLast: boolean;
  isPausing: boolean;
  isResuming: boolean;
  isDeleting: boolean;
  onToggleExpanded: () => void;
  onPause: () => void;
  onResume: () => void;
  onDelete: () => void;
}) {
  const targetLabel = task.targetLabel || task.deliveryTarget;

  return (
    <div className={cn(!isLast && "border-b border-border")}>
      <div className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-start sm:justify-between">
        <button
          type="button"
          className="flex min-w-0 flex-1 items-start gap-3 text-left"
          onClick={onToggleExpanded}
          aria-expanded={isExpanded}
          aria-label={isExpanded ? `Hide details for ${task.prompt}` : `Show details for ${task.prompt}`}
        >
          <span className="mt-0.5 rounded-md border border-border bg-background p-1 text-muted-foreground">
            <CaretRightIcon size={12} className={cn("transition-transform", isExpanded && "rotate-90")} />
          </span>

          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="min-w-0 flex-1 text-sm font-medium leading-6 text-foreground line-clamp-2">{task.prompt}</p>
              <TaskStatusBadge status={task.status} />
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <Badge variant="outline">{task.targetKindLabel}</Badge>
              <span>{targetLabel}</span>
              <span className="hidden sm:inline">•</span>
              <span>{task.scheduleLabel}</span>
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <span>Session: {formatSessionMode(task.sessionMode)}</span>
              <span>Next run: {formatDateTime(task.nextRunAt)}</span>
              <span>Last run: {formatDateTime(task.lastRunAt)}</span>
              <span>Created: {formatDateTime(task.createdAt)}</span>
              {isAdmin ? <span>Created by: {task.creatorName ?? task.createdBy ?? "Unknown"}</span> : null}
            </div>
          </div>
        </button>

        <div className="flex shrink-0 items-center gap-2 self-end sm:self-start">
          {task.canPause ? (
            <Button
              variant="outline"
              size="xs"
              onClick={onPause}
              disabled={isPausing || isResuming || isDeleting}
              aria-label={`Pause ${task.prompt}`}
            >
              {isPausing ? <SpinnerGapIcon size={12} className="animate-spin" /> : <PauseIcon size={12} />}
              Pause
            </Button>
          ) : null}

          {task.canResume ? (
            <Button
              variant="outline"
              size="xs"
              onClick={onResume}
              disabled={isPausing || isResuming || isDeleting}
              aria-label={`Resume ${task.prompt}`}
            >
              {isResuming ? <SpinnerGapIcon size={12} className="animate-spin" /> : <PlayIcon size={12} />}
              Resume
            </Button>
          ) : null}

          {task.canDelete ? (
            <Button
              variant="ghost"
              size="xs"
              className="text-destructive hover:text-destructive"
              onClick={onDelete}
              disabled={isPausing || isResuming || isDeleting}
              aria-label={`Delete ${task.prompt}`}
            >
              {isDeleting ? <SpinnerGapIcon size={12} className="animate-spin" /> : <TrashIcon size={12} />}
              Delete
            </Button>
          ) : null}
        </div>
      </div>

      {isExpanded ? (
        <div className="border-t border-border bg-muted/20 px-4 py-4">
          <dl className="grid gap-4 text-sm sm:grid-cols-2">
            <DetailItem label="Delivery target" value={task.deliveryTarget} />
            <DetailItem label="Timezone" value={task.timezone} />
            <DetailItem label="Task ID" value={task.id} />
            <DetailItem label="Schedule type" value={task.scheduleType} />
            <DetailItem label="Schedule value" value={task.scheduleValue} />
            <DetailItem label="Thread" value={task.threadTs ?? "None"} />
          </dl>
        </div>
      ) : null}
    </div>
  );
}

function DetailItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1">
      <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="break-all text-sm text-foreground">{value}</dd>
    </div>
  );
}

function TaskStatusBadge({ status }: { status: ScheduledTaskListItem["status"] }) {
  if (status === "active") {
    return <Badge className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-300">Active</Badge>;
  }

  if (status === "paused") {
    return <Badge variant="secondary">Paused</Badge>;
  }

  return <Badge variant="outline">Completed</Badge>;
}

function DeleteTaskDialog({
  task,
  isDeleting,
  onOpenChange,
  onConfirm,
}: {
  task: ScheduledTaskListItem | null;
  isDeleting: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog open={!!task} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete scheduled task?</AlertDialogTitle>
          <AlertDialogDescription>
            This removes the task permanently. Future runs will not be triggered.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={onConfirm} disabled={isDeleting}>
            {isDeleting ? (
              <>
                <SpinnerGapIcon size={14} className="animate-spin" />
                Deleting...
              </>
            ) : (
              "Delete"
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function EmptyState() {
  return (
    <div className="rounded-lg border border-border bg-card px-6 py-10 text-center">
      <h2 className="text-sm font-medium">No scheduled tasks yet</h2>
      <p className="mt-2 text-sm text-muted-foreground">
        Create a scheduled task by asking the assistant to remind you or run something on a schedule.
      </p>
    </div>
  );
}

function ErrorState() {
  return (
    <div className="rounded-lg border border-border bg-card px-6 py-10 text-center">
      <p className="text-sm text-destructive">Failed to load scheduled tasks.</p>
    </div>
  );
}

function LoadingSkeleton() {
  const skeletonRows = ["task-skeleton-1", "task-skeleton-2", "task-skeleton-3"];

  return (
    <div className="rounded-lg border border-border bg-card">
      {skeletonRows.map((rowId, index) => (
        <div key={rowId} className={cn("space-y-3 px-4 py-4", index < 2 && "border-b border-border")}>
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0 flex-1 space-y-2">
              <Skeleton className="h-4 w-3/4" />
              <Skeleton className="h-3 w-5/6" />
              <Skeleton className="h-3 w-2/3" />
            </div>
            <Skeleton className="h-6 w-16" />
          </div>
          <div className="flex gap-2">
            <Skeleton className="h-6 w-16" />
            <Skeleton className="h-6 w-16" />
          </div>
        </div>
      ))}
    </div>
  );
}

function formatSessionMode(sessionMode: ScheduledTaskListItem["sessionMode"]) {
  if (sessionMode === "chat") return "Chat";
  if (sessionMode === "persistent") return "Persistent";
  return "Fresh";
}
