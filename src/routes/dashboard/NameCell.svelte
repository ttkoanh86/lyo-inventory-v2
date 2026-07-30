<script lang="ts">
    export let value: any = "";
    export let row: any = {};

    // 🟢 BẮT BẪY KÉP: Lấy value -> Nếu trống lấy row.name -> Nếu trống nữa lấy row.sku
    function getName(v: any, r: any) {
        if (v && String(v).trim() !== "") return String(v).trim();
        if (r && r.name && String(r.name).trim() !== "") return String(r.name).trim();
        return "---";
    }

    $: displayName = getName(value, row);
</script>

<div class="custom-name-cell">
    {displayName}
</div>

<style>
    .custom-name-cell {
        white-space: normal !important;
        word-break: break-word !important;
        line-height: 1.4 !important;
        padding: 6px 0;
        font-size: 13px;
        color: #111;
        font-weight: 500;
        display: block !important;
        width: 100%;
    }
</style>
