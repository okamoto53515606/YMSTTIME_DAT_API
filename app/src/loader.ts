import fs from 'fs';
import path from 'path';

/**
 * YMSTPOST.DATから読み込んだ郵便番号→仕分コードのレコード
 */
export interface PostRecord {
  zip: string;
  sort_code: string;  // 7桁 仕分コード1
  base_no: string;    // 先頭3桁 = ベースNo
  updated_at: string; // YYYYMMDD
}

/**
 * YMSTTIME.DATから読み込んだリードタイムレコード
 */
export interface TimeRecord {
  delivery_days: number; // 最短配達日数 (11=配達不可)
  time_from: string;     // 受取開始時間帯 (08/14/16/18/99)
  time_to: string;       // 受取終了時間帯 (20/99)
  updated_at: string;    // YYYYMMDD
}

// 郵便番号(7桁) → PostRecord
export const postMap = new Map<string, PostRecord>();

// 発ベースNo(3桁) + 着仕分コード(5桁) → TimeRecord
export const timeMap = new Map<string, TimeRecord>();

/**
 * YMSTPOST.DAT レコード構造 (50バイト固定長 + CRLF = 52バイト/レコード)
 *
 * オフセット(0始まり):
 *   0     : '1' 固定
 *   1-7   : 郵便番号 (7桁)
 *   8-11  : スペース (4バイト)
 *   12-18 : 仕分コード1 (7桁) ← 2024年版以降はこちらを使用
 *   19-25 : 仕分コード2 (7桁)
 *   26-41 : 日付・区分等 (16バイト)
 *   42-49 : 更新日 YYYYMMDD (8バイト)
 */
const POST_DATA_SIZE = 50;
const POST_RECORD_SIZE = 52; // data(50) + CRLF(2)

/**
 * YMSTTIME.DAT レコード構造 (40バイト固定長 + CRLF = 42バイト/レコード)
 *
 * オフセット(0始まり):
 *   0-2   : 発ベースNo (3桁)
 *   3-7   : 着仕分コード (5桁)
 *   8-9   : スペース (2バイト)
 *   10-11 : 最短配達日数 (2桁: 02=翌日, 03=翌々日... 11=配達不可)
 *   12-13 : 受取開始時間帯 (2桁: 08/14/16/18/99)
 *   14-15 : 受取終了時間帯 (2桁: 20/99)
 *   16-31 : サービスレベル詳細 (16バイト)
 *   32-39 : 更新日 YYYYMMDD (8バイト)
 */
const TIME_DATA_SIZE = 40;
const TIME_RECORD_SIZE = 42; // data(40) + CRLF(2)

const DATA_DIR = process.env.DATA_DIR
  ? process.env.DATA_DIR
  : path.join(__dirname, '..', 'YTCMST');

export function loadData(): void {
  loadPostData();
  loadTimeData();
  console.log(`Loaded: postMap=${postMap.size} entries, timeMap=${timeMap.size} entries`);
}

function loadPostData(): void {
  const filePath = path.join(DATA_DIR, 'YMSTPOST.DAT');
  const buf = fs.readFileSync(filePath);

  for (let i = 0; i + POST_DATA_SIZE <= buf.length; i += POST_RECORD_SIZE) {
    const zip = buf.slice(i + 1, i + 8).toString('ascii');
    const sortCode = buf.slice(i + 12, i + 19).toString('ascii').trim();
    const updatedAt = buf.slice(i + 42, i + 50).toString('ascii').trim();

    if (zip && sortCode) {
      postMap.set(zip, {
        zip,
        sort_code: sortCode,
        base_no: sortCode.slice(0, 3),
        updated_at: updatedAt,
      });
    }
  }
}

function loadTimeData(): void {
  const filePath = path.join(DATA_DIR, 'YMSTTIME.DAT');
  const buf = fs.readFileSync(filePath);

  for (let i = 0; i + TIME_DATA_SIZE <= buf.length; i += TIME_RECORD_SIZE) {
    const baseNo = buf.slice(i, i + 3).toString('ascii');
    const sortCode5 = buf.slice(i + 3, i + 8).toString('ascii');
    const key = baseNo + sortCode5; // 8桁の検索キー

    const daysStr = buf.slice(i + 10, i + 12).toString('ascii');
    const timeFrom = buf.slice(i + 12, i + 14).toString('ascii');
    const timeTo = buf.slice(i + 14, i + 16).toString('ascii');
    const updatedAt = buf.slice(i + 32, i + 40).toString('ascii').trim();

    const days = parseInt(daysStr, 10);
    if (!isNaN(days)) {
      timeMap.set(key, {
        delivery_days: days,
        time_from: timeFrom,
        time_to: timeTo,
        updated_at: updatedAt,
      });
    }
  }
}
