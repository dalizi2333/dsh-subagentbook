import z from '@deepseek-ai/schemastery';
import { teachingFixture } from './teaching-fixture.mjs';
export const Config = z.object({ registryJson: z.string().default('{}').volatile(), entriesJson: z.string().default('{}').volatile() });
export function apply(ctx) { ctx.provide('promptbook', teachingFixture()); }
