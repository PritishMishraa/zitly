import { getDestinationForCountry } from '@/helpers/route-ops';
import { getLink } from '@repo/data-ops/queries/links';
import { cloudflareInfoSchema } from '@repo/data-ops/zod-schema/links';
import { Hono } from 'hono';

export const App = new Hono<{ Bindings: Env }>();

App.get('/:id', async (c) => {
	const id = c.req.param('id');

	const linkInfo = await getLink(id);
	if (!linkInfo) {
		return c.text('Destination not found', 404);
	}

	const cfHeader = cloudflareInfoSchema.safeParse(c.req.raw.cf);
	if (!cfHeader.success) {
		return c.text('Invalid Cloudflare headers', 400);
	}

	const headers = cfHeader.data;
	const destination = getDestinationForCountry(linkInfo, headers.country);
	
	return c.redirect(destination);
});
