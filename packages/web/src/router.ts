import { createRouter } from "@tanstack/react-router";
import { channelsRoute } from "./routes/channels";
import { connectionsCallbackRoute, connectionsRoute } from "./routes/connections";
import { dashboardRoute } from "./routes/dashboard";
import { filesRoute } from "./routes/files";
import { indexRoute } from "./routes/index";
import { loginRoute } from "./routes/login";
import { onboardingRoute } from "./routes/onboarding";
import { rootRoute } from "./routes/root";
import { scheduledTasksRoute } from "./routes/scheduled-tasks";
import { skillsRoute } from "./routes/skills";
import { teamRoute } from "./routes/team";
import { workspaceRoute } from "./routes/workspace";

const routeTree = rootRoute.addChildren([
  loginRoute,
  onboardingRoute,
  indexRoute,
  dashboardRoute.addChildren([
    channelsRoute,
    teamRoute,
    scheduledTasksRoute,
    skillsRoute,
    filesRoute,
    workspaceRoute,
    connectionsRoute.addChildren([connectionsCallbackRoute]),
  ]),
]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
