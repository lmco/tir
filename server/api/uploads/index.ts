export default defineEventHandler(async (event) => {
  const tus = event.context.tus;
  if (!tus) {
    throw createError({ statusCode: 500, statusMessage: "Upload handler is not available." });
  }
  if (event.method === "OPTIONS") return tus.handle(null);

  const checkResult = await userCheck(event, undefined, undefined, undefined);
  return tus.handle(checkResult.user.id);
});
