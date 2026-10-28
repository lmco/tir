interface CurrentUser {
  UserRole?: {
    name?: string;
  };
}

export default defineNuxtRouteMiddleware(async (to) => {
  const publicPaths = ["/", "/login"];

  if (publicPaths.includes(to.path)) {
    return;
  }

  const { data: user, error } = await useFetch<CurrentUser>("/api/auth/currentUser");

  if (error.value || !user.value) {
    return navigateTo("/");
  }

  if (to.path.startsWith("/administration")) {
    if (!user.value.UserRole?.name?.toUpperCase().includes("ADMIN")) {
      return abortNavigation({
        statusCode: 403,
        statusMessage: "Insufficient permissions.",
      });
    }
  }
});
