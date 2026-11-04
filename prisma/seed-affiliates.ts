import { prisma } from "@/db/prisma";
import { seedAffiliates } from "./seeds/affiliates";

// Solo afiliados de ejemplo, para BD ya sembradas: `pnpm seed:affiliates`.
seedAffiliates().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
