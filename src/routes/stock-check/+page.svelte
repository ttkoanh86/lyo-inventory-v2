<script lang="ts">
    import { goto } from "$app/navigation";
    import { onMount } from "svelte";
    // Kế thừa lại ItemViewV2 từ thư mục dashboard
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
    <ItemViewV2 />
{/key}
