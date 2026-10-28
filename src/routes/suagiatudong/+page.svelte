<script lang="ts">
	import { adjust_order_prices_auto, cancel_sapo_order } from "../dashboard/DataPipelineV2";

	let order_input = $state("");
	let is_loading = $state(false);
	let current_action = $state<"adjust" | "cancel" | "">(""); 
	let result_data: any = $state(null);
	let error_message = $state("");

	// 1. XỬ LÝ TỰ ĐỘNG SỬA GIÁ
	async function handle_auto_adjust() {
		if (!order_input.trim()) {
			alert("Vui lòng nhập Mã đơn hàng cần sửa giá!");
			return;
		}

		is_loading = true;
		current_action = "adjust";
		result_data = null;
		error_message = "";

		try {
			const res = await adjust_order_prices_auto(order_input);
			if (res && res.success) {
				result_data = { ...res, action_type: "adjust" };
			} else {
				error_message = res?.message || "Không thể thực hiện điều chỉnh giá đơn hàng!";
			}
		} catch (e) {
			error_message = "Xảy ra lỗi trong quá trình tự động sửa giá!";
		} finally {
			is_loading = false;
		}
	}

	// 2. XỬ LÝ HỦY ĐƠN HÀNG (CÓ HỘP THOẠI XÁC NHẬN)
	async function handle_cancel_order() {
		const clean_code = order_input.trim();
		if (!clean_code) {
			alert("Vui lòng nhập Mã đơn hàng cần hủy!");
			return;
		}

		const confirmed = confirm(
			`⚠️ BẠN CÓ CHẮC CHẮN MUỐN HỦY ĐƠN: ${clean_code}?\n\nĐiều kiện hủy: Đơn phải đang ở bước ĐẶT HÀNG hoặc ĐÃ DUYỆT (chưa đóng gói/xuất kho). Thao tác này sẽ hủy đơn và hoàn tồn kho trên Sapo.`
		);
		if (!confirmed) return;

		is_loading = true;
		current_action = "cancel";
		result_data = null;
		error_message = "";

		try {
			const res = await cancel_sapo_order(clean_code);
			if (res && res.success) {
				result_data = { ...res, action_type: "cancel" };
			} else {
				error_message = res?.message || "Không thể hủy đơn hàng này!";
			}
		} catch (e) {
			error_message = "Xảy ra lỗi trong quá trình hủy đơn hàng!";
		} finally {
			is_loading = false;
		}
	}

	function formatCurrency(num: number) {
		return new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND" }).format(num || 0);
	}
</script>

<svelte:head>
	<title>LYO Quản Trị - Sửa Giá & Hủy Đơn Sapo</title>
</svelte:head>

<div class="container">
	<div class="header">
		<h2>⚡ TIỆN ÍCH XỬ LÝ ĐƠN HÀNG SAPO</h2>
		<p>Nhập Mã đơn hàng sỉ (VD: SON02290), sau đó chọn <b>SỬA GIÁ ĐƠN</b> để tự động kiểm tra cộng dồn nâng giá sỉ hoặc <b>HỦY ĐƠN HÀNG</b> để hủy đơn và hoàn trả tồn kho trên Sapo.</p>
	</div>
	<!-- KHỐI HƯỚNG DẪN QUY TẮC ĐƯỢC CẬP NHẬT -->
<div style="background: #f0f9ff; border: 1px solid #bae6fd; border-radius: 8px; padding: 18px 22px; margin-bottom: 24px; color: #0f172a; font-size: 14px; line-height: 1.6;">
  <h3 style="color: #0369a1; margin-bottom: 12px; font-size: 15px; display: flex; align-items: center; gap: 8px;">
    📖 QUY TẮC TẠO ĐƠN VÀ GHI CHÚ (NOTE) SỬA GIÁ:
  </h3>

  <ul style="padding-left: 20px; margin: 0; display: flex; flex-direction: column; gap: 8px;">
    <li>
      <b>Quy tắc bảng giá đơn hàng:</b> Chọn chính sách giá theo mốc giá thấp nhất (số lượng ít nhất) của các sản phẩm có trong đơn (Ví dụ: Đơn có sản phẩm SL 10 và sản phẩm SL 50 &rarr; Phải chọn bảng giá nền là <b>Bán buôn</b>, không được chọn VVIP ngay từ đầu). Các khách có chính sách mặc định SL20 hoặc VVIP sẽ được miễn trừ kiểm tra số lượng sàn ở bước này.
    </li>

    <li>
      <b>Cú pháp mốc giá nâng lên theo số lượng:</b> Ghi đúng từ khóa viết tắt: 
      <b><code>ĐL</code></b> (Đại lý, SL &ge; 100) | 
      <b><code>VVIP</code></b> (SL &ge; 50, hoặc 30/40 theo khách riêng) | 
      <b><code>SL20</code></b> (SL &ge; 20) | 
      <b><code>SL[Số lượng]</code></b> (SL &ge; 200, 500, 1000... theo bảng giá SKU trên Sheet).
    </li>

    <li style="background: #fef9c3; border-left: 4px solid #eab308; padding: 8px 12px; border-radius: 4px; margin: 4px 0;">
      <b>Đặc quyền thương hiệu riêng (Không cần check SL):</b> Ghi cú pháp <b><code>VVIP + Tên Hãng</code></b> (Ví dụ: <b><code>VVIP3CE</code></b> hoặc <b><code>VVIP 3CE</code></b>, sau này có thể thêm <b><code>VVIPTORRIDEN</code></b>...)[cite: 1]. Chỉ áp dụng cho đúng mã khách hàng được phân quyền trên Google Sheet và đúng dòng sản phẩm của hãng đó, sửa trực tiếp trên từng dòng, không dùng cú pháp gộp dòng[cite: 1].
    </li>

    <li>
      <b>Đơn lẻ 1 dòng dù SL:</b> Chỉ cần ghi mốc giá vào dòng đó (Ví dụ: <b><code>ĐL</code></b> hoặc <b><code>SL20</code></b> hoặc <b><code>VVIP</code></b> hoặc <b><code>SL200</code></b>)[cite: 1].
    </li>

    <li>
      <b>Gộp số lượng các dòng:</b> Ghi kèm số thứ tự dòng cách nhau bởi dấu phẩy (Ví dụ: <b><code>ĐL: 1,2</code></b>[cite: 4] hoặc <b><code>SL20: 3,4,5</code></b> hoặc <b><code>SL500: 1,3</code></b>)[cite: 1].
    </li>

    <li>
      <b>Điều kiện gộp hợp lệ:</b> Các dòng gộp phải cùng loại sản phẩm cha, cùng mức giá ban đầu và thuộc nhóm: <b>Son, Phấn, Chì kẻ mày, Mặt nạ</b> (hoặc thuộc danh sách mã sản phẩm được mở rộng trên tab <b><code>SP_CONG_DON</code></b> của Sheet như <i>C931, D69, A607</i> cho phép gộp khác giá ban đầu)[cite: 1].
    </li>
  </ul>
</div>

	<div class="search-box">
		<input 
			type="text" 
			bind:value={order_input} 
			placeholder="Nhập mã đơn hàng Sapo (VD: SON02290)..." 
			onkeydown={(e) => { if (e.key === 'Enter') handle_auto_adjust(); }}
		/>
		<button class="btn-submit btn-adjust" onclick={handle_auto_adjust} disabled={is_loading}>
			{is_loading && current_action === 'adjust' ? "ĐANG SỬA GIÁ..." : "⚡ SỬA GIÁ ĐƠN"}
		</button>
		<button class="btn-submit btn-cancel" onclick={handle_cancel_order} disabled={is_loading}>
			{is_loading && current_action === 'cancel' ? "ĐANG HỦY..." : "🛑 HỦY ĐƠN HÀNG"}
		</button>
	</div>

	{#if error_message}
		<div class="alert alert-error">
			❌ {error_message}
		</div>
	{/if}

	{#if result_data}
		<!-- KẾT QUẢ KHI HỦY ĐƠN THÀNH CÔNG -->
		{#if result_data.action_type === "cancel"}
			<div class="alert alert-cancelled">
				🛑 <b>{result_data.message}</b>
			</div>
		{/if}

		<!-- KẾT QUẢ KHI SỬA GIÁ THÀNH CÔNG -->
		{#if result_data.action_type === "adjust"}
			<div class="alert alert-success">
				{result_data.message} (Mã đơn: <b>{result_data.order_code}</b>)
			</div>

			{#if result_data.details && result_data.details.length > 0}
				<div class="result-table">
					<h3>📋 CÁC SẢN PHẨM ĐÃ ĐƯỢC ĐIỀU CHỈNH GIÁ:</h3>
					<table>
						<thead>
							<tr>
								<th>SKU</th>
								<th>Tên sản phẩm</th>
								<th>Số lượng</th>
								<th>Giá cũ</th>
								<th>Giá mới áp dụng</th>
								<th>Bảng giá áp dụng</th>
								<th>Trạng thái</th>
							</tr>
						</thead>
						<tbody>
							{#each result_data.details as item}
								<tr class="highlight">
									<td><b>{item.sku}</b></td>
									<td><b>{item.name}</b></td>
									<td><b>{item.quantity}</b></td>
									<td class="old-price">{formatCurrency(item.old_price)}</td>
									<td class="new-price">{formatCurrency(item.new_price)}</td>
									<td><span class="badge">{item.rule}</span></td>
									<td><span class="status-changed">✅ Đã cập nhật</span></td>
								</tr>
							{/each}
						</tbody>
					</table>
				</div>
			{/if}
		{/if}
	{/if}
</div>

<style>
	.container { max-width: 950px; margin: 40px auto; padding: 25px; background: #ffffff; border-radius: 8px; box-shadow: 0 4px 15px rgba(0,0,0,0.08); font-family: Arial, sans-serif; }
	.header h2 { color: #0284c7; margin-bottom: 8px; font-size: 22px; }
	.header p { color: #64748b; font-size: 14px; margin-bottom: 25px; line-height: 1.5; }
	
	.search-box { display: flex; gap: 10px; margin-bottom: 25px; }
	.search-box input { flex: 1; padding: 12px 16px; border: 2px solid #cbd5e1; border-radius: 6px; font-size: 15px; outline: none; transition: border-color 0.2s; }
	.search-box input:focus { border-color: #0284c7; }
	
	.btn-submit { padding: 12px 20px; color: white; border: none; border-radius: 6px; font-weight: bold; font-size: 14px; cursor: pointer; transition: all 0.2s; white-space: nowrap; }
	.btn-adjust { background: #0284c7; }
	.btn-adjust:hover { background: #0369a1; }
	.btn-cancel { background: #ef4444; }
	.btn-cancel:hover { background: #dc2626; }
	.btn-submit:disabled { background: #94a3b8; cursor: not-allowed; }

	.alert { padding: 14px 18px; border-radius: 6px; font-size: 14px; margin-bottom: 25px; font-weight: bold; }
	.alert-success { background: #f0fdf4; color: #166534; border: 1px solid #bbf7d0; }
	.alert-cancelled { background: #fff1f2; color: #9f1239; border: 1px solid #fecdd3; }
	.alert-error { background: #fef2f2; color: #991b1b; border: 1px solid #fecaca; }

	.result-table h3 { font-size: 15px; color: #334155; margin-bottom: 12px; }
	table { width: 100%; border-collapse: collapse; font-size: 14px; }
	th, td { padding: 12px; text-align: left; border-bottom: 1px solid #e2e8f0; }
	th { background: #f8fafc; color: #475569; font-weight: bold; }
	tr.highlight { background-color: #f0f9ff; }
	.old-price { color: #94a3b8; text-decoration: line-through; }
	.new-price { color: #0284c7; font-weight: bold; }
	.badge { background: #e0f2fe; color: #0369a1; padding: 4px 8px; border-radius: 4px; font-size: 12px; font-weight: bold; }
	.status-changed { color: #166534; font-weight: bold; }
</style>
