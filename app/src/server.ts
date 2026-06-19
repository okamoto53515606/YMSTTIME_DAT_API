import Fastify from 'fastify';
import { postMap, timeMap } from './loader';

const server = Fastify({
  logger: {
    level: process.env.LOG_LEVEL || 'info',
  },
});

/**
 * ヘルスチェック（Lambda Web Adapter の readiness check 用）
 */
server.get('/health', async (_request, reply) => {
  return reply.send({ status: 'ok' });
});

/**
 * API① 郵便番号から仕分コード検索
 * GET /yamato/postcode/:zip
 */
server.get<{
  Params: { zip: string };
}>(
  '/yamato/postcode/:zip',
  {
    schema: {
      params: {
        type: 'object',
        properties: {
          zip: { type: 'string', pattern: '^[0-9]{7}$' },
        },
        required: ['zip'],
      },
      response: {
        200: {
          type: 'object',
          properties: {
            zip: { type: 'string' },
            sort_code: { type: 'string' },
            base_no: { type: 'string' },
            updated_at: { type: 'string' },
          },
        },
        404: {
          type: 'object',
          properties: {
            error: { type: 'string' },
            zip: { type: 'string' },
          },
        },
      },
    },
  },
  async (request, reply) => {
    const { zip } = request.params;
    const record = postMap.get(zip);
    if (!record) {
      return reply.status(404).send({ error: 'Zip code not found', zip });
    }
    return record;
  }
);

/**
 * API② 宅急便の最短お届け日検索
 * GET /yamato/leadtime?from_zip=&to_zip=&ship_date=
 */
server.get<{
  Querystring: { from_zip: string; to_zip: string; ship_date: string };
}>(
  '/yamato/leadtime',
  {
    schema: {
      querystring: {
        type: 'object',
        properties: {
          from_zip: { type: 'string', pattern: '^[0-9]{7}$' },
          to_zip: { type: 'string', pattern: '^[0-9]{7}$' },
          ship_date: { type: 'string', pattern: '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' },
        },
        required: ['from_zip', 'to_zip', 'ship_date'],
      },
    },
  },
  async (request, reply) => {
    const { from_zip, to_zip, ship_date } = request.query;

    const fromPost = postMap.get(from_zip);
    if (!fromPost) {
      return reply.status(404).send({ error: 'from_zip not found', zip: from_zip });
    }

    const toPost = postMap.get(to_zip);
    if (!toPost) {
      return reply.status(404).send({ error: 'to_zip not found', zip: to_zip });
    }

    const fromBaseNo = fromPost.sort_code.slice(0, 3);
    const toSortCode5 = toPost.sort_code.slice(0, 5);
    const key = fromBaseNo + toSortCode5;

    const timeRecord = timeMap.get(key);
    if (!timeRecord) {
      return reply.status(404).send({
        error: 'No lead time data found',
        from_base_no: fromBaseNo,
        to_sort_code: toSortCode5,
      });
    }

    const deliveryDays = timeRecord.delivery_days;
    const deliverable = deliveryDays !== 11;

    // earliest_delivery_date = ship_date + (delivery_days - 1) 日
    const earliestDeliveryDate = addDays(ship_date, deliveryDays - 1);

    return {
      from_zip,
      to_zip,
      ship_date,
      from_base_no: fromBaseNo,
      to_sort_code: toSortCode5,
      delivery_days: deliveryDays,
      earliest_delivery_date: earliestDeliveryDate,
      earliest_time_from: timeRecord.time_from,
      earliest_time_to: timeRecord.time_to,
      deliverable,
    };
  }
);

/**
 * YYYY-MM-DD 形式の日付に日数を加算して返す
 */
function addDays(dateStr: string, days: number): string {
  const [year, month, day] = dateStr.split('-').map(Number);
  const d = new Date(Date.UTC(year, month - 1, day));
  d.setUTCDate(d.getUTCDate() + days);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

export default server;
