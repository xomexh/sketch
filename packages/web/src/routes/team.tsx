/**
 * Team page — manage workspace members.
 * Primary use case: add WhatsApp users so they can chat with the bot.
 * Slack users are auto-created on first DM; this page lets admins manage
 * WhatsApp access and see everyone.
 */
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import type { User } from "@/lib/api";
import { api } from "@/lib/api";
import { getInitials } from "@/lib/utils";
import { type AuthContext, useDashboardAuth } from "@/routes/dashboard";
import {
  CheckCircleIcon,
  ClockIcon,
  DotsThreeIcon,
  EnvelopeIcon,
  PencilSimpleIcon,
  PlusIcon,
  SlackLogoIcon,
  SpinnerGapIcon,
  UserMinusIcon,
  UsersThreeIcon,
  WhatsappLogoIcon,
} from "@phosphor-icons/react";
import { emailSchema, whatsappNumberSchema } from "@sketch/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { dashboardRoute } from "./dashboard";

const optionalEmail = z.literal("").or(emailSchema);
const optionalPhone = z.literal("").or(whatsappNumberSchema);

const addMemberSchema = z.object({
  name: z.string().min(1),
  email: emailSchema,
  whatsappNumber: optionalPhone,
});

const editMemberSchema = z.object({
  name: z.string().min(1),
  email: optionalEmail,
  whatsappNumber: optionalPhone,
});

export const teamRoute = createRoute({
  getParentRoute: () => dashboardRoute,
  path: "/team",
  component: TeamPage,
});

export function TeamPage() {
  const auth = useDashboardAuth();
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["users"],
    queryFn: () => api.users.list(),
  });

  const [showAddDialog, setShowAddDialog] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [removingUser, setRemovingUser] = useState<User | null>(null);

  const users = data?.users ?? [];
  const isMember = auth.role === "member";

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Team</h1>
        {!isMember && (
          <Button size="sm" onClick={() => setShowAddDialog(true)}>
            <PlusIcon size={14} weight="bold" />
            Add member
          </Button>
        )}
      </div>

      <div className="mt-6">
        {isLoading ? (
          <LoadingSkeleton />
        ) : users.length === 0 ? (
          isMember ? (
            <p className="text-sm text-muted-foreground">No team members yet.</p>
          ) : (
            <EmptyState onAdd={() => setShowAddDialog(true)} />
          )
        ) : (
          <MemberList users={users} auth={auth} onEdit={setEditingUser} onRemove={setRemovingUser} />
        )}
      </div>

      {!isMember && (
        <AddMemberDialog
          open={showAddDialog}
          onOpenChange={setShowAddDialog}
          onSuccess={() => {
            queryClient.invalidateQueries({ queryKey: ["users"] });
          }}
        />
      )}

      <EditMemberDialog
        user={editingUser}
        isMember={isMember}
        onOpenChange={(open) => !open && setEditingUser(null)}
        onSuccess={() => {
          setEditingUser(null);
          queryClient.invalidateQueries({ queryKey: ["users"] });
        }}
      />

      {!isMember && (
        <RemoveMemberDialog
          user={removingUser}
          onOpenChange={(open) => !open && setRemovingUser(null)}
          onSuccess={() => {
            setRemovingUser(null);
            queryClient.invalidateQueries({ queryKey: ["users"] });
          }}
        />
      )}
    </div>
  );
}

function MemberList({
  users,
  auth,
  onEdit,
  onRemove,
}: {
  users: User[];
  auth: AuthContext;
  onEdit: (user: User) => void;
  onRemove: (user: User) => void;
}) {
  const isMember = auth.role === "member";

  return (
    <>
      <p className="mb-3 text-sm font-medium text-muted-foreground">Team members</p>
      <div className="rounded-lg border border-border bg-card">
        {users.map((user, i) => {
          const isCurrentUser = isMember && user.id === auth.userId;

          return (
            <MemberRow
              key={user.id}
              user={user}
              isCurrentUser={isCurrentUser}
              isMember={isMember}
              isLast={i === users.length - 1}
              onEdit={() => onEdit(user)}
              onRemove={() => onRemove(user)}
            />
          );
        })}
      </div>
    </>
  );
}

function MemberRow({
  user,
  isCurrentUser,
  isMember,
  isLast,
  onEdit,
  onRemove,
}: {
  user: User;
  isCurrentUser: boolean;
  isMember: boolean;
  isLast: boolean;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const initials = getInitials(user.name);
  // Admin sees actions on all rows except their own "You" row.
  // Member sees edit (no delete) only on their own row.
  const showActions = isMember ? isCurrentUser : !isCurrentUser;
  const showDelete = !isMember;

  return (
    <div className={`flex items-center gap-4 px-4 py-4 ${isLast ? "" : "border-b border-border"}`}>
      <Avatar className="size-9">
        <AvatarFallback className="text-xs font-medium">{initials}</AvatarFallback>
      </Avatar>

      <div className="flex min-w-0 flex-1 items-center gap-2">
        <span className="truncate text-sm font-medium">{user.name}</span>
        {isCurrentUser && (
          <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
            You
          </Badge>
        )}
      </div>

      <TooltipProvider>
        <div className="flex items-center gap-2">
          <ChannelBadge
            icon={<SlackLogoIcon size={16} />}
            active={!!user.slack_user_id}
            tooltip={user.slack_user_id ? "Slack connected" : "Slack not connected"}
            activeColor="#E01E5A"
          />
          <ChannelBadge
            icon={<WhatsappLogoIcon size={16} />}
            active={!!user.whatsapp_number}
            tooltip={user.whatsapp_number ? "WhatsApp connected" : "WhatsApp not connected"}
            activeColor="#25D366"
          />
          <ChannelBadge
            icon={<EnvelopeIcon size={16} />}
            active={!!user.email}
            tooltip={
              user.email
                ? user.email_verified_at
                  ? "Email verified"
                  : "Email pending verification"
                : "Email not added"
            }
            activeColor={user.email ? (user.email_verified_at ? "#0072FC" : "#F59E0B") : "#0072FC"}
          />
        </div>
      </TooltipProvider>

      {showActions && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="size-7">
              <DotsThreeIcon size={16} />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={onEdit}>
              <PencilSimpleIcon size={14} className="mr-2" />
              Edit
            </DropdownMenuItem>
            {showDelete && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem className="text-destructive" onClick={onRemove}>
                  <UserMinusIcon size={14} className="mr-2" />
                  Remove member
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}

function ChannelBadge({
  icon,
  active,
  tooltip,
  activeColor,
}: {
  icon: React.ReactNode;
  active: boolean;
  tooltip: string;
  activeColor: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={active ? "" : "text-muted-foreground/50"} style={active ? { color: activeColor } : undefined}>
          {icon}
        </span>
      </TooltipTrigger>
      <TooltipContent>
        <p>{tooltip}</p>
      </TooltipContent>
    </Tooltip>
  );
}

function EmptyState({ onAdd }: { onAdd: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border py-12 text-center">
      <div className="flex size-12 items-center justify-center rounded-full bg-muted">
        <UsersThreeIcon size={24} className="text-muted-foreground" />
      </div>
      <p className="mt-4 text-sm font-medium">Your team's empty!</p>
      <p className="mt-1 max-w-xs text-xs text-muted-foreground">Add your first team member to get started.</p>
      <Button size="sm" className="mt-4" onClick={onAdd}>
        <PlusIcon size={14} weight="bold" />
        Add member
      </Button>
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="space-y-3">
      <Skeleton className="h-4 w-24" />
      <div className="rounded-lg border border-border bg-card">
        {[1, 2, 3].map((i) => (
          <div key={i} className={`flex items-center gap-4 px-4 py-4 ${i < 3 ? "border-b border-border" : ""}`}>
            <Skeleton className="size-9 rounded-full" />
            <Skeleton className="h-4 w-36" />
            <div className="ml-auto flex gap-2">
              <Skeleton className="size-4" />
              <Skeleton className="size-4" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function AddMemberDialog({
  open,
  onOpenChange,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState("");

  const createMutation = useMutation({
    mutationFn: () =>
      api.users.create({
        name: name.trim(),
        email: email.trim() || null,
        whatsappNumber: phone.trim() || null,
      }),
    onSuccess: (data) => {
      if (data.verificationSent) {
        toast.success("Member added. Verification email sent.");
      } else {
        toast.success("Member added");
      }
      resetAndClose();
      onSuccess();
    },
    onError: (err: Error) => {
      if (err.message.includes("already linked")) {
        setError("This number is already linked to another member");
      } else {
        toast.error(err.message);
      }
    },
  });

  const resetAndClose = () => {
    setName("");
    setEmail("");
    setPhone("");
    setError("");
    onOpenChange(false);
  };

  const canSubmit = addMemberSchema.safeParse({
    name: name.trim(),
    email: email.trim(),
    whatsappNumber: phone.trim(),
  }).success;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) resetAndClose();
        else onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add member</DialogTitle>
          <DialogDescription>Add a new team member. Name and email are required.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="add-name">Name</Label>
            <Input
              id="add-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Full name"
              disabled={createMutation.isPending}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="add-email">Email</Label>
            <Input
              id="add-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@example.com"
              disabled={createMutation.isPending}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="add-phone">WhatsApp number</Label>
            <Input
              id="add-phone"
              value={phone}
              onChange={(e) => {
                setPhone(e.target.value);
                setError("");
              }}
              placeholder="+91 98765 43210"
              disabled={createMutation.isPending}
            />
            {error && <p className="text-xs text-destructive">{error}</p>}
          </div>
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" disabled={createMutation.isPending}>
              Cancel
            </Button>
          </DialogClose>
          <Button onClick={() => createMutation.mutate()} disabled={!canSubmit || createMutation.isPending}>
            {createMutation.isPending ? (
              <>
                <SpinnerGapIcon size={14} className="animate-spin" />
                Adding...
              </>
            ) : (
              "Add member"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function EditMemberDialog({
  user,
  isMember,
  onOpenChange,
  onSuccess,
}: {
  user: User | null;
  isMember: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (user) {
      setName(user.name);
      setEmail(user.email ?? "");
      setPhone(user.whatsapp_number ?? "");
      setError("");
    }
  }, [user]);

  const updateMutation = useMutation({
    mutationFn: () =>
      api.users.update(user?.id ?? "", {
        name: name.trim(),
        ...(isMember ? {} : { email: email.trim() || null }),
        whatsappNumber: phone.trim() || null,
      }),
    onSuccess: (data) => {
      if (data.verificationSent) {
        toast.success("Member updated. Verification email sent.");
      } else {
        toast.success("Member updated");
      }
      onSuccess();
    },
    onError: (err: Error) => {
      if (err.message.includes("already linked")) {
        setError("This number is already linked to another member");
      } else {
        toast.error(err.message);
      }
    },
  });

  const resendMutation = useMutation({
    mutationFn: () => api.users.resendVerification(user?.id ?? ""),
    onSuccess: (data) => {
      if (data.sent) {
        toast.success("Verification email sent");
      } else {
        toast.success("Verification link logged to server console (SMTP not configured)");
      }
    },
    onError: (err: Error) => toast.error(err.message),
  });

  const isDirty =
    user &&
    (name.trim() !== user.name ||
      (email.trim() || null) !== (user.email ?? null) ||
      (phone.trim() || null) !== (user.whatsapp_number ?? null));
  const canSubmit =
    isDirty &&
    editMemberSchema.safeParse({ name: name.trim(), email: email.trim(), whatsappNumber: phone.trim() }).success;

  return (
    <Dialog open={!!user} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit member</DialogTitle>
          <DialogDescription>Update this member's details.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="edit-name">Name</Label>
            <Input
              id="edit-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={updateMutation.isPending}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="edit-email">Email</Label>
            <Input
              id="edit-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@example.com"
              disabled={updateMutation.isPending || isMember}
            />
            {isMember && <p className="text-xs text-muted-foreground">Contact your admin to change your email.</p>}
            {user?.email && email === user.email && (
              <div className="flex items-center gap-1.5">
                {user.email_verified_at ? (
                  <span className="flex items-center gap-1 text-xs text-green-600">
                    <CheckCircleIcon size={14} weight="fill" />
                    Verified
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-xs text-amber-600">
                    <ClockIcon size={14} />
                    Pending verification
                    <button
                      type="button"
                      className="ml-1 text-xs underline hover:no-underline disabled:opacity-50"
                      disabled={resendMutation.isPending}
                      onClick={() => resendMutation.mutate()}
                    >
                      {resendMutation.isPending ? "Sending..." : "Resend"}
                    </button>
                  </span>
                )}
              </div>
            )}
          </div>

          {user?.slack_user_id && (
            <div className="space-y-1.5">
              <Label className="text-muted-foreground">Slack</Label>
              <div className="flex items-center gap-2 rounded-md border border-border bg-muted/50 px-3 py-2">
                <SlackLogoIcon size={16} style={{ color: "#E01E5A" }} />
                <span className="text-sm text-muted-foreground">Connected</span>
              </div>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="edit-phone">WhatsApp number</Label>
            <Input
              id="edit-phone"
              value={phone}
              onChange={(e) => {
                setPhone(e.target.value);
                setError("");
              }}
              placeholder="+91 98765 43210"
              disabled={updateMutation.isPending}
            />
            {error ? (
              <p className="text-xs text-destructive">{error}</p>
            ) : phone.trim() ? (
              <p className="text-xs text-muted-foreground">
                This number will be linked to {user?.name}'s identity on WhatsApp.
              </p>
            ) : null}
          </div>
        </div>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" disabled={updateMutation.isPending}>
              Cancel
            </Button>
          </DialogClose>
          <Button onClick={() => updateMutation.mutate()} disabled={!canSubmit || updateMutation.isPending}>
            {updateMutation.isPending ? (
              <>
                <SpinnerGapIcon size={14} className="animate-spin" />
                Saving...
              </>
            ) : (
              "Save changes"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RemoveMemberDialog({
  user,
  onOpenChange,
  onSuccess,
}: {
  user: User | null;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}) {
  const removeMutation = useMutation({
    mutationFn: () => api.users.remove(user?.id ?? ""),
    onSuccess: () => {
      toast.success(`${user?.name} has been removed`);
      onSuccess();
    },
    onError: (err: Error) => {
      toast.error(err.message);
    },
  });

  return (
    <Dialog open={!!user} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Remove team member?</DialogTitle>
          <DialogDescription asChild>
            <div className="space-y-2 text-sm">
              <p>{user?.name} will lose access to this Sketch workspace immediately.</p>
              <p className="text-muted-foreground">Their past conversations will be retained.</p>
            </div>
          </DialogDescription>
        </DialogHeader>

        <DialogFooter>
          <DialogClose asChild>
            <Button variant="outline" disabled={removeMutation.isPending}>
              Cancel
            </Button>
          </DialogClose>
          <Button variant="destructive" onClick={() => removeMutation.mutate()} disabled={removeMutation.isPending}>
            {removeMutation.isPending ? (
              <>
                <SpinnerGapIcon size={14} className="animate-spin" />
                Removing...
              </>
            ) : (
              "Remove"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
