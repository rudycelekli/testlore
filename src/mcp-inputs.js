import {z} from 'zod';

// Keep advertised read-only inputs and qualification validation on one schema.
export const briefInputSchema = z.strictObject({
  task: z.string().max(2000).optional(),
  changed: z.array(z.string().min(1).max(1000)).max(1000).optional()
});
export const statusInputSchema = z.strictObject({});
