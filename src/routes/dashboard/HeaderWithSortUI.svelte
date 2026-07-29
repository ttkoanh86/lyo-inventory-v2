<script lang="ts">
    // @ts-ignore
    import {
        Button,
        Portal,
        Dropdown,
        Field,
        Text,
        Select,
        Checkbox,
        Segmented
        // @ts-ignore
    } from "wx-svelte-core";
    import { getContext, onMount } from "svelte";
    import type { ProductV2 } from "./DataPipelineV2";
    import type { Sorting } from "./Template";
    import { normalizeToEnglish, type Filtering } from "./Template";
    import Page from "../+page.svelte";
    import { write } from "xlsx";

    let { column, cell, api } = $props();
    let updateKeys: any = getContext("updatekeys");
    let filter_by_id: Map<string, Filtering> = getContext("filterbyid");
    let sort_by_id: Map<string, Sorting> = getContext("sortbyid");
    let filter_update_key: any = getContext("filter_update_key");

    let show_dropdown = $state(false);
    let col_width = 0;
    
    let unique_vals = $state(new Set<any>());
    let filtered_unique_vals = $state(new Set<any>());

    let t = $state("");
    let u = $state(0);

    let sort_direction: 1 | -1 | 0 = $state(0);

    // Store checked unique values
    let included_unique_values = $state(new Set<any>());

    // For string filtering
    let string_filtering_value = $state("");

    // For number filtering
    let number_filtering_operator: ">" | "<" | "=" | ">=" | "<=" | "!=" = $state(">");
    let number_filtering_value = $state(0);
    const number_filtering_options = [
        { id: ">", label: ">" },
        { id: "<", label: "<" },
        { id: ">=", label: "≥" },
        { id: "<=", label: "≤" },
        { id: "=", label: "=" },
        { id: "!=", label: "≠" }
    ];

    async function reset() {
        string_filtering_value = "";
        sort_direction = 0;
        number_filtering_value = 0;
        number_filtering_operator = ">";
        included_unique_values.clear();
        filtered_unique_vals.clear();

        for (let val of unique_vals) {
            filtered_unique_vals.add(val);
            included_unique_values.add(val);
        }
        u++;
    }

    // 🟢 HÀM NẠP TẤT CẢ GIÁ TRỊ MỚI NHẤT MỖI KHI ĐỔI TAB/KHO
    function refreshUniqueValues() {
        unique_vals.clear();
        filtered_unique_vals.clear();
        included_unique_values.clear();

        const dsource = updateKeys?.dsource || [];
        for (let v of dsource) {
            const rawVal = v[column.id as keyof ProductV2];
            if (rawVal !== undefined && rawVal !== null && rawVal !== "") {
                unique_vals.add(rawVal);
                filtered_unique_vals.add(rawVal);
                included_unique_values.add(rawVal);
            }
        }

        // Xác định kiểu dữ liệu
        t = "string";
        for (let r of unique_vals) {
            t = typeof r;
            break;
        }

        loadCurrentFilter();
        u++;
    }

    async function initialize() {
        col_width = cell.width;
        refreshUniqueValues();
        await get_sorter_state();
    }

    // 🟢 THEO DÕI SỰ THAY ĐỔI CỦA TAB/KHO ĐỂ CẬP NHẬT TỰ ĐỘNG
    $effect(() => {
        if (updateKeys?.headerSorterKey || updateKeys?.dsource) {
            refreshUniqueValues();
        }
    });

    onMount(async () => {
        await initialize();
    });

    async function loadCurrentFilter() {
        if (filter_by_id.has(column.id)) {
            const x = filter_by_id.get(column.id);
            if (x) {
                if (t === "string") {
                    included_unique_values = x.includes;
                    string_filtering_value = x.value;
                } else if (t === "number") {
                    number_filtering_operator = x.operator;
                    number_filtering_value = x.value;
                    included_unique_values = x.includes;
                }
            }

            filtered_unique_vals.clear();
            if (t === "string") {
                const search = normalizeToEnglish(String(string_filtering_value || "").toLowerCase().trim());
                for (let _u of unique_vals) {
                    const itemStr = normalizeToEnglish(String(_u || "").toLowerCase().trim());
                    if (itemStr.includes(search)) {
                        filtered_unique_vals.add(_u);
                    }
                }
            } else if (t === "number") {
                for (let _u of unique_vals) {
                    if (eval_comparison(_u, Number(number_filtering_value), number_filtering_operator)) {
                        filtered_unique_vals.add(_u);
                    }
                }
            }
            return true;
        }
        return false;
    }

    let has_updated = false;
    async function writeFilter() {
        if (!has_updated) return;
        has_updated = false;

        if (t === "string") filter_by_id.set(column.id, { key: column.id, includes: included_unique_values, operator: "in", value: string_filtering_value, type: t });
        else if (t === "number") filter_by_id.set(column.id, { key: column.id, includes: included_unique_values, operator: number_filtering_operator, value: number_filtering_value, type: t });

        filter_update_key.k += 1;
    }

    let timer: number | undefined = undefined;

    function eval_comparison(a: number, b: number, op: ">" | "<" | "=" | ">=" | "<=" | "!=") {
        if (typeof a === "number" && typeof b === "number") {
            if (op === ">=") return a >= b;
            if (op === "<=") return a <= b;
            if (op === "=") return a === b;
            if (op === "!=") return a !== b;
            if (op === "<") return a < b;
            if (op === ">") return a > b;
        }
        return false;
    }

    async function update_filter() {
        has_updated = true;
        if (timer) {
            clearTimeout(timer);
            timer = undefined;
        }

        timer = setTimeout(() => {
            filtered_unique_vals.clear();
            included_unique_values.clear();

            if (t === "string") {
                const search = normalizeToEnglish(String(string_filtering_value || "").toLowerCase().trim());
                for (let _u of unique_vals) {
                    const itemStr = normalizeToEnglish(String(_u || "").toLowerCase().trim());
                    if (itemStr.includes(search)) {
                        filtered_unique_vals.add(_u);
                        included_unique_values.add(_u);
                    }
                }
            } else if (t === "number") {
                for (let _u of unique_vals) {
                    if (eval_comparison(_u, Number(number_filtering_value), number_filtering_operator)) {
                        filtered_unique_vals.add(_u);
                        included_unique_values.add(_u);
                    }
                }
            }
            u++;
        }, 1);
    }

    function get_sorter_state() {
        const x = sort_by_id.get(column.id);
        if (x) sort_direction = x.order;
        else sort_direction = 0;
    }

    function handle_sorter_toggle() {
        sort_by_id.set(column.id, { key: column.id, order: sort_direction });
        filter_update_key.k += 1;
    }

    async function handle_item_checkbox_toggling(ev: any, item: any) {
        has_updated = true;
        if (ev.value === true) {
            included_unique_values.add(item);
        } else {
            included_unique_values.delete(item);
        }
    }

    async function handle_selectall_toggle() {
        if (included_unique_values.size === filtered_unique_vals.size) {
            included_unique_values.clear();
        } else {
            filtered_unique_vals.forEach((v) => {
                included_unique_values.add(v);
            });
        }
        has_updated = true;
        u++;
    }

    async function handle_dropdown_toggle() {
        show_dropdown = !show_dropdown;
        if (show_dropdown) {
            refreshUniqueValues(); // Đảm bảo nạp dữ liệu mới nhất khi mở Popup
            api.exec("resize-column", { id: column.id, width: 250 });
        } else {
            api.exec("resize-column", { id: column.id, width: col_width });
            await writeFilter();
        }
    }

    async function erase_filter() {
        sort_by_id.delete(column.id);
        filter_by_id.delete(column.id);
        api.exec("resize-column", { id: column.id, width: col_width });
        await reset();
        filter_update_key.k += 1;
    }

    function isMouseIntersecting(event: MouseEvent, rect: DOMRect) {
        return (event.clientX >= rect.x && event.clientX <= rect.x + rect.width && event.clientY >= rect.y && event.clientY <= rect.y + rect.height);
    }

    document.addEventListener("mouseup", async (event) => {
        if (!show_dropdown) return;
        const master_div = document.getElementById(column.id + "_dropdown");
        if (master_div) {
            const rect0 = master_div.querySelector("div#toggle-btn-wrapper");
            if (rect0 && isMouseIntersecting(event, rect0.getBoundingClientRect())) return;

            const rect = master_div.querySelector("div.wx-dropdown");
            if (rect && !isMouseIntersecting(event, rect.getBoundingClientRect())) {
                await handle_dropdown_toggle();
                return;
            }
        }
    });
</script>

{#key updateKeys.headerSorterKey}
    <div
        style="width: 100%; display: flex; flex-direction: row; align-items: center; justify-content: space-between "
        id={column.id + "_dropdown"}
    >
        <p>{cell.text}</p>
        <div style="max-height: 30px; display: flex" id="toggle-btn-wrapper">
            {#if sort_by_id.has(cell.id) || filter_by_id.has(cell.id)}
            <Button
                onclick={handle_dropdown_toggle}
                icon="mdi mdi-sort"
                type="primary"
                style="height: 30px;"
            ></Button>
            {:else}
            <Button
                onclick={handle_dropdown_toggle}
                icon="mdi mdi-sort"
                type="secondary"
                style="height: 30px;"
            ></Button>
            {/if}
            {#if show_dropdown}
                {#if t == "string"}
                <div
                    id="dropdown-section"
                    style="width: fit-content; height: fit-content"
                >
                    <Dropdown autoFit={false}>
                        <div
                            style="min-width: 250px; padding: 10px; padding-top: 0px"
                        >
                            <p style="margin-bottom: 5px; margin-top: 10px">
                                Sắp xếp
                            </p>
                            <div style=" display: flex; gap: 5px">
                                <button onclick={handle_dropdown_toggle} style="background: transparent; border: transparent">
                                <Segmented onchange={handle_sorter_toggle} bind:value={sort_direction} options={[
                                    {id: 1, label:"A đến Z", icon:"mdi mdi-sort-alphabetical-ascending"},
                                    {id: -1, label:"Z đến A", icon:"mdi mdi-sort-alphabetical-descending"}
                                ]}></Segmented>
                                </button>
                            </div>

                            <p style="margin-bottom: 5px; margin-top: 10px">
                                Lọc
                            </p>

                            <Text bind:value={string_filtering_value} onchange={update_filter} placeholder="Tìm kiếm..."></Text>
                            <div
                                style=";display: flex; max-height: 170px; overflow-y: scroll; flex-direction: column; gap: 5px; padding-top: 5px"
                            >
                                <div style="height: 32px;">
                                <Button onclick={handle_selectall_toggle}>Chọn/Bỏ chọn tất cả</Button>
                                </div>
                                {#key u}
                                {#each filtered_unique_vals as unique_val}
                                    <Checkbox value={included_unique_values.has(unique_val)} onchange={async (ev: any) => {handle_item_checkbox_toggling(ev, unique_val)}} label={String(unique_val)}></Checkbox>
                                {/each}
                                {/key}
                            </div>
                            <div style="padding-top: 5px;">
                                <Button onclick={handle_dropdown_toggle}>Ok</Button>
                                <Button type="danger" onclick={erase_filter}>Xóa bộ lọc</Button>
                            </div>
                        </div>
                    </Dropdown>
                </div>
                {:else if t == "number"}
                <div
                    id="dropdown-section"
                    style="width: fit-content; height: fit-content"
                >
                    <Dropdown autoFit={false}>
                        <div
                            style="min-width: 250px; padding: 10px; padding-top: 0px"
                        >
                            <p style="margin-bottom: 5px; margin-top: 10px">
                                Sắp xếp
                            </p>
                            <div style=" display: flex; gap: 5px">
                                <button onclick={handle_dropdown_toggle} style="background: transparent; border: transparent">
                                <Segmented onchange={handle_sorter_toggle} bind:value={sort_direction} options={[
                                    {id: 1, label:"Tăng dần", icon:"mdi mdi-arrow-up"},
                                    {id: -1, label:"Giảm dần", icon:"mdi mdi-arrow-down"}
                                ]}></Segmented>
                                </button>
                            </div>

                            <p style="margin-bottom: 5px; margin-top: 10px">
                                Lọc
                            </p>
                            <div style="display: flex; gap: 5px">
                                <Select onchange={update_filter} bind:value={number_filtering_operator} options={number_filtering_options}></Select>
                                <Text onchange={update_filter} bind:value={number_filtering_value} placeholder="Nhập số..."></Text>
                            </div>

                            <div
                                style=";display: flex; max-height: 170px; overflow-y: scroll; flex-direction: column; gap: 5px; padding-top: 5px"
                            >
                                <div style="height: 32px;">
                                <Button onclick={handle_selectall_toggle}>Chọn/Bỏ chọn tất cả</Button>
                                </div>
                                {#key u}
                                {#each filtered_unique_vals as unique_val}
                                    <Checkbox value={included_unique_values.has(unique_val)} label={String(unique_val)} onchange={(ev: any) => {handle_item_checkbox_toggling(ev, unique_val)} }></Checkbox>
                                {/each}
                                {/key}
                            </div>
                            <div style="padding-top: 5px;">
                                <Button onclick={handle_dropdown_toggle}>Ok</Button>
                                <Button type="danger" onclick={erase_filter}>Xóa bộ lọc</Button>
                            </div>
                        </div>
                    </Dropdown>
                </div>
                {:else if t == "object"}
                <pre>unimplemented</pre>
                {/if}
            {/if}
        </div>
    </div>
{/key}
