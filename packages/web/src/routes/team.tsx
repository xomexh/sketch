/**
 * Team page — manage workspace members.
 * Primary use case: add WhatsApp users so they can chat with the bot.
 * Slack users are auto-created on first DM; this page lets admins manage
 * WhatsApp access and see everyone. Agents are first-class team members with
 * a type toggle in the add dialog and a Robot icon avatar in the list.
 */
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
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
  RobotIcon,
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

const addAgentSchema = z.object({
  name: z.string().min(1),
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
  const [activeTab, setActiveTab] = useState("list");

  const users = data?.users ?? [];
  const isMember = auth.role === "member";

  return (
    <div className="px-6 py-8">
      <div className="mx-auto max-w-3xl">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold">Team</h1>
          {!isMember && (
            <Button size="sm" onClick={() => setShowAddDialog(true)}>
              <PlusIcon size={14} weight="bold" />
              Add member
            </Button>
          )}
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="mt-6">
        <div className="mx-auto w-full max-w-3xl">
          <TabsList>
            <TabsTrigger value="list">List</TabsTrigger>
            <TabsTrigger value="chart">Chart</TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="list">
          <div className="mx-auto w-full max-w-3xl">
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
        </TabsContent>
        <TabsContent value="chart">{isLoading ? <LoadingSkeleton /> : <OrgChart users={users} />}</TabsContent>
      </Tabs>

      {!isMember && (
        <AddMemberDialog
          open={showAddDialog}
          users={users}
          onOpenChange={setShowAddDialog}
          onSuccess={() => {
            queryClient.invalidateQueries({ queryKey: ["users"] });
          }}
        />
      )}

      <EditMemberDialog
        user={editingUser}
        users={users}
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

export interface TreeNode {
  user: User;
  children: TreeNode[];
}

export function buildTree(users: User[]): TreeNode[] {
  const byId = new Map(users.map((u) => [u.id, { user: u, children: [] as TreeNode[] }]));
  const roots: TreeNode[] = [];
  for (const node of byId.values()) {
    if (node.user.reports_to && byId.has(node.user.reports_to)) {
      byId.get(node.user.reports_to)?.children.push(node);
    } else {
      roots.push(node);
    }
  }
  return roots;
}

function OrgChart({ users }: { users: User[] }) {
  const roots = buildTree(users);

  if (users.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border py-12 text-center">
        <p className="text-sm text-muted-foreground">No team members yet.</p>
      </div>
    );
  }

  const allRoots = roots.every((r) => r.children.length === 0) && roots.length > 1;

  return (
    <div className="overflow-x-auto py-4">
      {allRoots && (
        <p className="mb-4 text-center text-xs text-muted-foreground">
          Set "Reports to" on team members to see the hierarchy.
        </p>
      )}
      <div className="flex min-w-fit justify-center">
        <ul className="flex gap-8">
          {roots.map((node) => (
            <li key={node.user.id} className="flex flex-col items-center">
              <OrgChartNode node={node} />
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function OrgChartNode({ node }: { node: TreeNode }) {
  const hasChildren = node.children.length > 0;

  return (
    <div className="flex flex-col items-center">
      <OrgChartCard user={node.user} />
      {hasChildren && (
        <>
          <div className="h-5 w-px bg-border" />
          <ul className="flex items-start">
            {node.children.map((child, i) => {
              const isFirst = i === 0;
              const isLast = i === node.children.length - 1;
              return (
                <li key={child.user.id} className="relative flex flex-col items-center">
                  <div className="flex h-5 w-full">
                    <div className={`w-1/2 ${isFirst ? "" : "border-t border-border"}`} />
                    <div className={`w-1/2 ${isLast ? "" : "border-t border-border"}`} />
                  </div>
                  <div className="absolute left-1/2 top-0 h-5 w-px -translate-x-px bg-border" />
                  <div className="px-2">
                    <OrgChartNode node={child} />
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}

function OrgChartCard({ user }: { user: User }) {
  const isAgent = user.type === "agent";
  const initials = getInitials(user.name);

  return (
    <Card className="w-48">
      <CardContent className="flex flex-col items-center p-4 text-center">
        <Avatar className="size-10">
          {isAgent ? (
            <AvatarFallback className="bg-primary/10 text-primary">
              <RobotIcon size={20} weight="fill" />
            </AvatarFallback>
          ) : (
            <AvatarFallback className="text-sm font-medium">{initials}</AvatarFallback>
          )}
        </Avatar>
        <div className="mt-2 flex items-center gap-1">
          <span className="text-sm font-medium">{user.name}</span>
          {isAgent && (
            <Badge variant="outline" className="px-1 py-0 text-[10px]">
              Agent
            </Badge>
          )}
        </div>
        {user.role && (
          <Badge variant="secondary" className="mt-1 text-[10px]">
            {user.role}
          </Badge>
        )}
        {user.description && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <p className="mt-1.5 line-clamp-2 text-xs text-muted-foreground">{user.description}</p>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="max-w-xs">
                <p>{user.description}</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
      </CardContent>
    </Card>
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
  const isAgent = user.type === "agent";
  // Admin sees actions on all rows except their own "You" row.
  // Member sees edit (no delete) only on their own row.
  const showActions = isMember ? isCurrentUser : !isCurrentUser;
  const showDelete = !isMember;

  return (
    <div className={`flex items-center gap-4 px-4 py-4 ${isLast ? "" : "border-b border-border"}`}>
      <Avatar className="size-9">
        {isAgent ? (
          <AvatarFallback className="bg-primary/10 text-primary">
            <RobotIcon size={16} weight="fill" />
          </AvatarFallback>
        ) : (
          <AvatarFallback className="text-xs font-medium">{initials}</AvatarFallback>
        )}
      </Avatar>

      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium">{user.name}</span>
          {isCurrentUser && (
            <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
              You
            </Badge>
          )}
          {isAgent && (
            <Badge variant="outline" className="text-[10px] px-1.5 py-0">
              Agent
            </Badge>
          )}
        </div>
        {user.role && <span className="text-xs text-muted-foreground">{user.role}</span>}
        {user.description && <span className="truncate text-xs text-muted-foreground">{user.description}</span>}
      </div>

      {!isAgent && (
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
      )}

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
  users,
  onOpenChange,
  onSuccess,
}: {
  open: boolean;
  users: User[];
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}) {
  const [memberType, setMemberType] = useState<"human" | "agent">("human");
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [description, setDescription] = useState("");
  const [reportsTo, setReportsTo] = useState("none");
  const [error, setError] = useState("");

  const createMutation = useMutation({
    mutationFn: () =>
      api.users.create({
        name: name.trim(),
        type: memberType,
        role: role.trim() || null,
        reportsTo: reportsTo === "none" ? null : reportsTo || null,
        description: description.trim() || null,
        ...(memberType === "human"
          ? {
              email: email.trim() || null,
              whatsappNumber: phone.trim() || null,
            }
          : {}),
      }),
    onSuccess: (data) => {
      if (data.verificationSent) {
        toast.success("Member added. Verification email sent.");
      } else {
        toast.success(memberType === "agent" ? "Agent added" : "Member added");
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
    setMemberType("human");
    setName("");
    setRole("");
    setEmail("");
    setPhone("");
    setDescription("");
    setReportsTo("none");
    setError("");
    onOpenChange(false);
  };

  const canSubmit =
    memberType === "agent"
      ? addAgentSchema.safeParse({ name: name.trim() }).success
      : addMemberSchema.safeParse({ name: name.trim(), email: email.trim(), whatsappNumber: phone.trim() }).success;

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
          <DialogTitle>{memberType === "agent" ? "Add agent" : "Add human member"}</DialogTitle>
          <DialogDescription>
            {memberType === "agent"
              ? "Add an AI agent to your team. Agents have no messaging channels."
              : "Add a new team member. Name and email are required."}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="flex rounded-md border border-border">
            <button
              type="button"
              className={`flex-1 rounded-l-md px-3 py-1.5 text-sm font-medium transition-colors ${
                memberType === "human"
                  ? "bg-primary text-primary-foreground"
                  : "bg-transparent text-muted-foreground hover:text-foreground"
              }`}
              onClick={() => setMemberType("human")}
            >
              Human
            </button>
            <button
              type="button"
              className={`flex-1 rounded-r-md px-3 py-1.5 text-sm font-medium transition-colors ${
                memberType === "agent"
                  ? "bg-primary text-primary-foreground"
                  : "bg-transparent text-muted-foreground hover:text-foreground"
              }`}
              onClick={() => setMemberType("agent")}
            >
              Agent
            </button>
          </div>

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
            <Label htmlFor="add-role">Role</Label>
            <Input
              id="add-role"
              value={role}
              onChange={(e) => setRole(e.target.value)}
              placeholder="e.g. VP Marketing, Research Assistant"
              disabled={createMutation.isPending}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="add-description">Description</Label>
            <Textarea
              id="add-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What does this person do? e.g. Marketing Lead, handles competitive analysis"
              disabled={createMutation.isPending}
              rows={2}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="add-reports-to">Reports to</Label>
            <Select value={reportsTo} onValueChange={setReportsTo}>
              <SelectTrigger id="add-reports-to">
                <SelectValue placeholder="None (root)" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None</SelectItem>
                {users.map((u) => (
                  <SelectItem key={u.id} value={u.id}>
                    {u.name}
                    {u.role ? ` — ${u.role}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {memberType === "human" && (
            <>
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
            </>
          )}
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
            ) : memberType === "agent" ? (
              "Add agent"
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
  users,
  isMember,
  onOpenChange,
  onSuccess,
}: {
  user: User | null;
  users: User[];
  isMember: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
}) {
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [description, setDescription] = useState("");
  const [reportsTo, setReportsTo] = useState("none");
  const [error, setError] = useState("");

  const isAgent = user?.type === "agent";

  useEffect(() => {
    if (user) {
      setName(user.name);
      setRole(user.role ?? "");
      setEmail(user.email ?? "");
      setPhone(user.whatsapp_number ?? "");
      setDescription(user.description ?? "");
      setReportsTo(user.reports_to ?? "none");
      setError("");
    }
  }, [user]);

  const updateMutation = useMutation({
    mutationFn: () =>
      api.users.update(user?.id ?? "", {
        name: name.trim(),
        role: role.trim() || null,
        reportsTo: reportsTo === "none" ? null : reportsTo || null,
        description: description.trim() || null,
        ...(isAgent
          ? {}
          : {
              ...(isMember ? {} : { email: email.trim() || null }),
              whatsappNumber: phone.trim() || null,
            }),
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

  const currentReportsTo = reportsTo === "none" ? null : reportsTo || null;
  const originalReportsTo = user?.reports_to ?? null;

  const isDirty =
    user &&
    (name.trim() !== user.name ||
      (role.trim() || null) !== (user.role ?? null) ||
      currentReportsTo !== originalReportsTo ||
      (description.trim() || null) !== (user.description ?? null) ||
      (!isAgent &&
        ((email.trim() || null) !== (user.email ?? null) ||
          (phone.trim() || null) !== (user.whatsapp_number ?? null))));

  const canSubmit =
    isDirty &&
    editMemberSchema.safeParse({ name: name.trim(), email: email.trim(), whatsappNumber: phone.trim() }).success;

  const otherUsers = users.filter((u) => u.id !== user?.id);

  return (
    <Dialog open={!!user} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit member</DialogTitle>
          <DialogDescription>Update this member's details.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div>
            {isAgent ? (
              <Badge variant="secondary">
                <RobotIcon size={12} weight="fill" className="mr-1" />
                Agent
              </Badge>
            ) : (
              <Badge variant="secondary">Human</Badge>
            )}
          </div>

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
            <Label htmlFor="edit-role">Role</Label>
            <Input
              id="edit-role"
              value={role}
              onChange={(e) => setRole(e.target.value)}
              placeholder="e.g. VP Marketing, Research Assistant"
              disabled={updateMutation.isPending}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="edit-description">Description</Label>
            <Textarea
              id="edit-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What does this person do? e.g. Marketing Lead, handles competitive analysis"
              disabled={updateMutation.isPending}
              rows={2}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="edit-reports-to">Reports to</Label>
            <Select value={reportsTo} onValueChange={setReportsTo}>
              <SelectTrigger id="edit-reports-to">
                <SelectValue placeholder="None (root)" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None</SelectItem>
                {otherUsers.map((u) => (
                  <SelectItem key={u.id} value={u.id}>
                    {u.name}
                    {u.role ? ` — ${u.role}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {!isAgent && (
            <>
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
            </>
          )}
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
