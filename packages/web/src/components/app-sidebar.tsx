import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarSeparator,
} from "@/components/ui/sidebar";
import { useTheme } from "@/hooks/use-theme";
import { api } from "@/lib/api";
import { getInitials } from "@/lib/utils";
/**
 * App sidebar — navigation, branding, and user actions.
 * Follows the designer's sidebar structure with Phosphor icons.
 */
import {
  BrainIcon,
  CaretUpDownIcon,
  ChatCircleIcon,
  GearIcon,
  LinkSimpleIcon,
  MoonIcon,
  SignOutIcon,
  SunIcon,
  UsersThreeIcon,
} from "@phosphor-icons/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation, useNavigate } from "@tanstack/react-router";

interface NavItem {
  label: string;
  icon: React.ReactNode;
  href: string;
  disabled?: boolean;
}

const primaryNav: NavItem[] = [
  { label: "Channels", icon: <ChatCircleIcon size={18} />, href: "/channels" },
  { label: "Team", icon: <UsersThreeIcon size={18} />, href: "/team" },
  { label: "Skills", icon: <BrainIcon size={18} />, href: "/skills" },
];

const adminNav: NavItem[] = [
  { label: "Integrations", icon: <LinkSimpleIcon size={18} />, href: "/integrations", disabled: true },
  { label: "Settings", icon: <GearIcon size={18} />, href: "/settings", disabled: true },
];

export function AppSidebar({
  displayName,
  displayIdentifier,
  role,
}: {
  displayName: string;
  displayIdentifier: string;
  role: "admin" | "member";
}) {
  const location = useLocation();
  const navigate = useNavigate();
  const { theme, toggleTheme } = useTheme();
  const queryClient = useQueryClient();

  const { data: identity } = useQuery({
    queryKey: ["settings", "identity"],
    queryFn: () => api.settings.identity(),
  });

  const logoutMutation = useMutation({
    mutationFn: () => api.auth.logout(),
    onSuccess: () => {
      queryClient.clear();
      navigate({ to: "/login" });
    },
  });

  const initials = getInitials(displayIdentifier);

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <div className="flex h-12 items-center gap-2 overflow-hidden">
          <img src="/sketch.png" alt="Sketch" className="size-7 shrink-0" />
          <div className="flex min-w-0 flex-col text-left">
            <span className="truncate text-base font-semibold tracking-tight">{identity?.botName ?? "Sketch"}</span>
            {identity?.orgName ? (
              <span className="truncate text-xs text-muted-foreground">{identity.orgName}</span>
            ) : null}
          </div>
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {primaryNav.map((item) => (
                <SidebarMenuItem key={item.href}>
                  <SidebarMenuButton
                    isActive={location.pathname === item.href}
                    onClick={() => !item.disabled && navigate({ to: item.href })}
                    disabled={item.disabled}
                    tooltip={item.label}
                  >
                    {item.icon}
                    <span>{item.label}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {role === "admin" && (
          <>
            <SidebarSeparator />

            <SidebarGroup>
              <SidebarGroupContent>
                <SidebarMenu>
                  {adminNav.map((item) => (
                    <SidebarMenuItem key={item.href}>
                      <SidebarMenuButton
                        isActive={location.pathname === item.href}
                        onClick={() => !item.disabled && navigate({ to: item.href })}
                        disabled={item.disabled}
                        tooltip={item.label}
                      >
                        {item.icon}
                        <span>{item.label}</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          </>
        )}
      </SidebarContent>

      <SidebarFooter>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="flex h-12 w-full items-center gap-2 overflow-hidden rounded-md text-left text-sm outline-none ring-sidebar-ring hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 active:bg-sidebar-accent active:text-sidebar-accent-foreground"
            >
              <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary/15 text-xs font-medium text-primary">
                {initials}
              </div>
              <div className="flex min-w-0 flex-1 flex-col text-left text-xs leading-tight">
                <span className="truncate font-medium">{displayName}</span>
                <span className="truncate text-muted-foreground">{displayIdentifier}</span>
              </div>
              <CaretUpDownIcon size={16} className="shrink-0 text-muted-foreground" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="top" align="start" className="w-56">
            <DropdownMenuItem onSelect={toggleTheme}>
              {theme === "dark" ? <SunIcon size={16} className="mr-2" /> : <MoonIcon size={16} className="mr-2" />}
              {theme === "dark" ? "Light mode" : "Dark mode"}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => logoutMutation.mutate()}>
              <SignOutIcon size={16} className="mr-2" />
              Log out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarFooter>
    </Sidebar>
  );
}
