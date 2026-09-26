<script lang="ts">
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';

	// 1. Kiểm tra đăng nhập
	onMount(() => {
		const token = sessionStorage.getItem('token') || localStorage.getItem('token');
		if (!token) {
			goto('/authentication');
		}
	});

	// 2. Khai báo các trạng thái (Svelte 5 Runes)
	let selectedWarehouse = $state('CÔNG TY TNHH LYO GROUP');
	let isStockCheckActive = $state(true); // Mặc định tự động bật chế độ Kiểm hàng
	let sortOrder = $state<'asc' | 'desc'>('asc'); // Mặc định xếp Tồn kho tăng dần

	// Danh sách kho
	let warehouses = ['CÔNG TY TNHH LYO GROUP', 'KHO PHU XUAN', 'KHO KHAC'];

	// Dữ liệu mẫu (Khi dì nối API, chỉ cần gán mảng dữ liệu thật vào biến rawProducts)
	let rawProducts = $state([
		{ sku: 'LYO1133', name: 'F478 - COCOON - Hộp quà áo + mũ + sữa chống nắng + xà phòng Cocoon', image: 'https://via.placeholder.com/50', warehouse: 'CÔNG TY TNHH LYO GROUP', stock: 1, incoming: 0, brand: 'cocoon' },
		{ sku: '8809248457377', name: 'F456 - FROMNATURE - Xịt Khoáng White Organia Good Nature Aloevera', image: 'https://via.placeholder.com/50', warehouse: 'CÔNG TY TNHH LYO GROUP', stock: 32, incoming: 0, brand: 'FROMNATURE' },
		{ sku: '880956306081', name: 'e813 - Dr.Pepti - Sữa Rửa Mặt Trà Xanh Herb Blending 110ml', image: 'https://via.placeholder.com/50', warehouse: 'CÔNG TY TNHH LYO GROUP', stock: 0, incoming: 0, brand: '<Không xác định>' },
		{ sku: 'LYO1134', name: 'Sản phẩm C - Tồn ít cần kiểm', image: 'https://via.placeholder.com/50', warehouse: 'CÔNG TY TNHH LYO GROUP', stock: 5, incoming: 2, brand: 'COCOON' },
		{ sku: 'LYO1135', name: 'Sản phẩm D - Tồn gần chạm mốc 20', image: 'https://via.placeholder.com/50', warehouse: 'CÔNG TY TNHH LYO GROUP', stock: 18, incoming: 0, brand: 'SOMEBYMI' }
	]);

	// 3. 🔥 THUẬT TOÁN LỌC VÀ SẮP XẾP SẢN PHẨM KIỂM HÀNG (Svelte 5 $derived)
	let filteredProducts = $derived(
		rawProducts
			.filter((item) => {
				// Điều kiện 1: Đúng Kho
				const matchWarehouse = !selectedWarehouse || item.warehouse === selectedWarehouse;

				// Điều kiện 2: Khi bật Kiểm hàng -> Chỉ lấy sản phẩm có 0 < Tồn kho <= 20
				if (isStockCheckActive) {
					return matchWarehouse && item.stock > 0 && item.stock <= 20;
				}

				return matchWarehouse;
			})
			.sort((a, b) => {
				// Sắp xếp theo Tồn kho
				return sortOrder === 'asc' ? a.stock - b.stock : b.stock - a.stock;
			})
	);

	// Hàm chuyển đổi Tăng <-> Giảm khi bấm tiêu đề Tồn kho
	function toggleSort() {
		sortOrder = sortOrder === 'asc' ? 'desc' : 'asc';
	}

	// Hàm bấm nút "Kiểm hàng" để kích hoạt lại
	function triggerStockCheck() {
		isStockCheckActive = true;
		sortOrder = 'asc'; // Đưa về mặc định tăng dần
	}
</script>

<div class="min-h-screen bg-gray-50 p-4">
	<!-- Thanh công cụ phía trên -->
	<div class="mb-4 flex flex-wrap items-center justify-between gap-3 rounded bg-white p-3 shadow-sm">
		<div class="flex items-center gap-2">
			<span class="text-sm font-medium">Kho:</span>
			<select bind:value={selectedWarehouse} class="rounded border bg-white p-1.5 text-sm font-semibold">
				{#each warehouses as wh}
					<option value={wh}>{wh}</option>
				{/each}
			</select>

			<button
				onclick={triggerStockCheck}
				class="flex items-center gap-1 rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
			>
				🔍 Kiểm hàng
			</button>
		</div>

		{#if isStockCheckActive}
			<div class="rounded border border-orange-200 bg-orange-50 px-3 py-1 text-sm font-semibold text-orange-800">
				⚠️ Đang lọc sản phẩm cần kiểm kho (0 &lt; Tồn kho &le; 20)
			</div>
		{/if}
	</div>

	<!-- Bảng hiển thị (ĐÃ LOẠI BỎ CHÍNH XÁC 3 CỘT SẢN LƯỢNG BÁN) -->
	<div class="overflow-x-auto rounded bg-white shadow">
		<table class="w-full border-collapse text-left text-sm">
			<thead class="border-b bg-gray-100 font-semibold text-gray-700">
				<tr>
					<th class="w-12 border-r p-3 text-center"><input type="checkbox" /></th>
					<th class="border-r p-3">SKU</th>
					<th class="border-r p-3">Tên sản phẩm</th>
					<th class="w-20 border-r p-3 text-center">Ảnh</th>

					<!-- CỘT TỒN KHO CÓ NÚT BẤM ĐỔI TĂNG / GIẢM -->
					<th
						class="select-none border-r p-3 transition hover:bg-gray-200"
						onclick={toggleSort}
						style="cursor: pointer;"
					>
						<div class="flex items-center justify-between gap-2">
							<span class="font-bold text-blue-900">Tồn kho</span>
							<span class="rounded bg-blue-100 px-1.5 py-0.5 text-xs font-extrabold text-blue-700">
								{sortOrder === 'asc' ? '▲ Tăng dần' : '▼ Giảm dần'}
							</span>
						</div>
					</th>

					<th class="border-r p-3">Đang về</th>
					<th class="p-3">Nhãn hiệu</th>
				</tr>
			</thead>
			<tbody>
				{#each filteredProducts as item}
					<tr class="border-b hover:bg-gray-50">
						<td class="border-r p-3 text-center"><input type="checkbox" /></td>
						<td class="border-r p-3 font-mono font-medium">{item.sku}</td>
						<td class="max-w-md border-r p-3 font-medium text-gray-800">{item.name}</td>
						<td class="border-r p-3 text-center">
							<img src={item.image} alt={item.sku} class="mx-auto h-12 w-12 rounded border object-cover" />
						</td>
						<!-- Hiển thị tồn kho nổi bật -->
						<td class="border-r p-3 text-base font-extrabold text-red-600">
							{item.stock}
						</td>
						<td class="border-r p-3 text-gray-600">{item.incoming}</td>
						<td class="p-3 text-gray-600">{item.brand}</td>
					</tr>
				{:else}
					<tr>
						<td colspan="7" class="p-8 text-center text-gray-500">
							🎉 Không có sản phẩm nào thỏa mãn điều kiện tồn kho (0 &lt; Tồn kho &le; 20) tại kho này.
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
</div>
