// Hook de arranque de Next: corre una sola vez al levantar el servidor.
// Acá se registran las tareas programadas (AD-002, src/jobs/scheduler.ts).
export async function register() {
  // node-cron necesita APIs de Node — no se carga en el runtime edge.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startJobs } = await import("@/jobs/scheduler");
    // Sin `await`: la corrida de arranque no debe demorar que el server
    // empiece a responder.
    void startJobs();
  }
}
