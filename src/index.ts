import { Hono } from 'hono';
import { Redis } from '@upstash/redis/cloudflare';

// test

type HygraphBindings = {
	HYGRAPH_ENDPOINT: string;
	HYGRAPH_API_KEY: string;
};

type RedisBindings = {
	UPSTASH_REDIS_REST_URL: string;
  UPSTASH_REDIS_REST_TOKEN: string;
};

type Bindings = HygraphBindings & RedisBindings;

const formatString = (template: string, ...args: string[]) => {
  return template.replace(/{([0-9]+)}/g, function (match, index) {
    return typeof args[index] === 'undefined' ? match : args[index];
  });
};

const query_posts = `
query Assets {
	posts(orderBy: createdAt_DESC, last: 5) {
		id
		createdAt
		title
		slug
	}
}
`;

const formatQuery = (id: string) => `
query Assets {
  post(where: { id: "${id}" }) {
    content {
      markdown
    }
    createdAt
    title
    slug
  }
}
`;

interface Post {
	data: {
		post: {
			content: {
				markdown: string;
			};
			createdAt: string;
			title: string;
			slug: string;
		};
	};
}

interface Posts {
	data: {
		posts: {
			content: {
				markdown: string;
			};
			id: string;
			createdAt: string;
			title: string;
			slug: string;
		}[];
	};
}

const fetch_one_and_cache = async (bindings: Bindings, query: string, id: string) => {
	const redis = Redis.fromEnv(bindings);
	const cached: Post = await redis.json.get(`blog:${id}`);

	if(cached) return new Response(JSON.stringify(cached), { status: 200 });

	const	{ HYGRAPH_ENDPOINT, HYGRAPH_API_KEY } = bindings;
	const resp = await fetch(`${HYGRAPH_ENDPOINT}`, {
		method: 'POST',
		headers: {
			'content-type': 'application/json',
			'authorization': `Bearer ${HYGRAPH_API_KEY}`,
		},
		'body': JSON.stringify({ query: query }),
	});

	const resp_json = await resp.json<Post>();
	await redis.json.set(`blog:${id}`, '$', JSON.stringify(resp_json));

	return resp;
}

const fetch_many_and_cache = async (bindings: Bindings, query: string) => {
	const	{ HYGRAPH_ENDPOINT, HYGRAPH_API_KEY } = bindings;

	return await fetch(`${HYGRAPH_ENDPOINT}`, {
		method: 'POST',
		headers: {
			'content-type': 'application/json',
			'authorization': `Bearer ${HYGRAPH_API_KEY}`,
		},
		'body': JSON.stringify({ query: query }),
	});
}

const app = new Hono<{Bindings: Bindings}>();

app.get('/posts', async c => {
	const resp = await fetch_many_and_cache(c.env, query_posts);
	const json_resp = await resp.json<Posts>();

	return c.json(json_resp, resp.status);
});

app.get('/post/:id', async c => {
	const { id } = c.req.param();
	const fquery = formatQuery(id);
	const resp = await fetch_one_and_cache(c.env, fquery, id);
	const json_resp = await resp.json<Post>();

	return c.json(json_resp, resp.status);
});

export default app;
