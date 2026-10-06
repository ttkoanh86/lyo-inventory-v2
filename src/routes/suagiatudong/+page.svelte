<script lang="ts">
	import { adjust_order_prices_auto } from "../dashboard/DataPipelineV2";

	let order_input = $state("");
	let is_loading = $state(false);
	let result_data: any = $state(null);
	let error_message = $state("");

	async function handle_auto_adjust() {
		if (!order_input.trim()) {
			alert("Vui lòng nhập Mã đơn hàng cần sửa giá!");
			return;
		}

		is_loading = true;
		result_data = null;
		error_message = "";

		try {
			const res = await adjust_order_prices_auto(order_input);
			if (res && res.success) {
				result_data = res;
			} else {
				error_message = res?.message || "Không thể thực hiện điều chỉnh giá đơn hàng!";
			}
		} catch (e) {
			error_message = "Xảy ra lỗi trong quá trình tự động sửa giá!";
		} finally {
			is_loading = false;
		}
	}

	function formatCurrency(num: number) {
		return new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND" }).format(num || 0);
	}
</script>

<svelte:head>
	<title>LYO Dự Báo - Sửa Giá Đơn Hàng Tự Động</title>
</svelte:head>

<div class="container">
	<div class="header">
		<h2>⚡ TỰ ĐỘNG SỬA GIÁ ĐƠN SỈ SAPO</h2>
		<p>Nhập Mã đơn hàng sỉ (ĐÃ SET GIÁ BÁN BUÔN) để hệ thống tự động kiểm tra và nâng cấp giá sang mức <b>1SP SL20</b> hoặc <b>VVIP</b> cho các sản phẩm đủ điều kiện số lượng[Sản phẩm được cộng dồn SL: Son, phấn, chì kẻ mày, mặt nạ].</p>
	</div>

	<div class="search-box">
		<input 
			type="text" 
			bind:value={order_input} 
			placeholder="Nhập mã đơn hàng Sapo (VD: SON02290)..." 
			onkeydown={(e) => { if (e.key === 'Enter') handle_auto_adjust(); }}
		/>
		<button class="btn-submit" onclick={handle_auto_adjust} disabled={is_loading}>
			{is_loading ? "ĐANG XỬ LÝ..." : "⚡ TỰ ĐỘNG CẬP NHẬT GIÁ"}
		</button>
	</div>

	{#if error_message}
		<div class="alert alert-error">
			❌ {error_message}
		</div>
	{/if}

	{#if result_data}
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
</div>

<style>
	.container { max-width: 950px; margin: 40px auto; padding: 25px; background: #ffffff; border-radius: 8px; box-shadow: 0 4px 15px rgba(0,0,0,0.08); font-family: Arial, sans-serif; }
	.header h2 { color: #0284c7; margin-bottom: 8px; font-size: 22px; }
	.header p { color: #64748b; font-size: 14px; margin-bottom: 25px; line-height: 1.5; }
	.search-box { display: flex; gap: 12px; margin-bottom: 25px; }
	.search-box input { flex: 1; padding: 12px 16px; border: 2px solid #cbd5e1; border-radius: 6px; font-size: 15px; outline: none; }
	.search-box input:focus { border-color: #0284c7; }
	.btn-submit { padding: 12px 24px; background: #0284c7; color: white; border: none; border-radius: 6px; font-weight: bold; font-size: 14px; cursor: pointer; transition: background 0.2s; }
	.btn-submit:hover { background: #0369a1; }
	.btn-submit:disabled { background: #94a3b8; cursor: not-allowed; }
	.alert { padding: 14px 18px; border-radius: 6px; font-size: 14px; margin-bottom: 25px; font-weight: bold; }
	.alert-success { background: #f0fdf4; color: #166534; border: 1px solid #bbf7d0; }
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
