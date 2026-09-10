-- 0064_a_batch_reaches_the_books.sql
-- Cả một lô nạp đi vào sổ, và nói ra dòng nào không đi được.
--
-- Duyệt một lô mới chỉ dựng ra các giao dịch; sổ kép sinh ra ở `post_gold_txn`,
-- gọi từng cái một. Với 1.126 dòng của năm 2026 thì phải có một câu gọi được cả
-- lô — nhưng gọi cả lô đặt ra hai câu hỏi mà một vòng lặp ngây thơ trả lời sai.
--
-- Thứ nhất là thứ tự. Phiếu giao hàng trỏ về phiếu cọc của nó, nên cọc phải vào
-- sổ trước. Đi theo ngày giao dịch là đi đúng thứ tự việc đã xảy ra.
--
-- Thứ hai là dòng hỏng. Một giao dịch thiếu thanh toán làm `post_gold_txn` ném
-- lỗi; nếu lỗi đó thoát ra thì cả lô cuộn lại và một dòng chặn được 1.125 dòng
-- còn lại. Ở đây nó bị bắt, dòng được nêu tên kèm số dòng trong sheet, rồi vòng
-- lặp đi tiếp. Hàm trả về **những dòng không vào được**: không dòng nào trả về
-- nghĩa là cả lô đã nằm trong sổ.

CREATE OR REPLACE FUNCTION pc49.post_import_batch(p_batch_id uuid)
RETURNS TABLE (row_no int, txn_id uuid, error text)
LANGUAGE plpgsql SET search_path = pc49, public AS $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT i.row_no AS rn, t.id AS tid
      FROM pc49.import_row i
      JOIN pc49.gold_txn t ON t.id = i.committed_ref
     WHERE i.batch_id = p_batch_id
       AND i.status = 'COMMITTED'
       AND t.journal_entry_id IS NULL
       AND t.voided_at IS NULL
     ORDER BY t.txn_date, i.row_no
  LOOP
    BEGIN
      PERFORM pc49.post_gold_txn(r.tid);
    EXCEPTION WHEN others THEN
      row_no := r.rn; txn_id := r.tid; error := SQLERRM;
      RETURN NEXT;
    END;
  END LOOP;
END $$;

GRANT EXECUTE ON FUNCTION pc49.post_import_batch(uuid) TO authenticated;

NOTIFY pgrst, 'reload schema';

INSERT INTO pc49.schema_migrations (version) VALUES ('0064_a_batch_reaches_the_books')
ON CONFLICT (version) DO NOTHING;
