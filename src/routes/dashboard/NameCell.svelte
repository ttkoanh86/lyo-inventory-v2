<script lang="ts">
    export let value: any = "";
    
    // Bẫy an toàn: Ép kiểu về chuỗi, nếu null/undefined thì trả về "---"
    $: safe_name = (value !== null && value !== undefined) ? String(value).trim() : "---";
</script>

<div class="custom-name-cell">
    {safe_name}
</div>

<style>
    .custom-name-cell {
        white-space: normal !important;
        word-break: break-word !important;
        line-height: 1.4 !important;
        padding: 4px 0;
        font-size: 13px;
        color: #111;
        display: block !important;
        width: 100%;
    }
</style>
