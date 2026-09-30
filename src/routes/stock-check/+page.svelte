<script lang="ts">
	import { goto } from "$app/navigation";
	import { onMount } from "svelte";
	import ItemViewV2 from "../dashboard/ItemViewV2.svelte";

	let k = $state(0);

	onMount(() => {
		const token = sessionStorage.getItem("token") || localStorage.getItem("token");
		if (!token) {
			goto("/authentication");
		}
	});
</script>

{#key k}
	<!-- Bật chế độ isStockCheck = true tối ưu riêng cho Kiểm Hàng -->
	<ItemViewV2 isStockCheck={true} />
{/key}
