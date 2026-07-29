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

    let { column, cell, api } = $props();
    let updateKeys: any = getContext("updatekeys");
    let filter_by_id: Map<string, Filtering> = getContext("filterbyid");
    let sort_by_id: Map<string, Sorting> = getContext("sortbyid");
    let filter_update_key: any = getContext("filter_update_key");

    let show_dropdown = $state(false);
    let col_width = 0;

    let sort_direction: 1 | -1 | 0 = $state(0);
    let included_unique_values = $state(new Set<any>());
    let string_filtering_value = $state("");

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

    // 🟢 TỰ ĐỘNG LẤY DANH SÁCH DUY NHẤT MỖI KHI TAB/KHO THAY ĐỔI MÀ KHÔNG GÂY LẶP STATE
    let dsource = $derived(updateKeys?.dsource || []);
    let unique_vals = $derived.by(() => {
        const s = new Set<any>();
        for (let v of dsource) {
            const rawVal = v[column.id as keyof ProductV2];
            if (rawVal !== undefined && rawVal !== null && rawVal !== "") {
                s.add(rawVal);
            }
        }
        return s;
    });

    let t = $derived.by(() => {
        for (let r of unique_vals) {
            return typeof r;
        }
        return "string";
    });

    // 🟢 LỌC DANH SÁCH THEO TỪ KHÓA TÌM KIẾM
    let filtered_unique_vals = $derived.by(() => {
        const result = new Set<any>();
        if (t === "string") {
            const search = normalizeToEnglish(String(string_filtering_value || "").toLowerCase().trim());
            for (let _u of unique_vals) {
                const itemStr = normalizeToEnglish(String(_u || "").toLowerCase().trim());
                if (itemStr.includes(search)) {
                    result.add(_u);
                }
            }
        } else if (t === "number") {
            for (let _u of unique_vals) {
                if (eval_comparison(_u, Number(number_filtering_value), number_filtering_operator)) {
                    result.add(_u);
                }
            }
        }
        return result;
    });

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

    onMount(() => {
        col_width = cell.width;
        get_sorter_state();
    });

    function get_sorter_state() {
        const x = sort_by_id.get(column.id);
        if (x) sort_direction = x.order;
        else sort_direction = 0;
    }

    function handle_sorter_toggle() {
        sort_by_id.set(column.id, { key: column.id, order: sort_direction });
        filter_update_key.k += 1;
    }

    async function writeFilter() {
        if (t === "string") {
            filter_by_id.set(column.id, { key: column.id, includes: included_unique_values, operator: "in", value: string_filtering_value, type: t });
        } else if (t === "number") {
            filter_by_id.set(column.id, { key: column.id, includes: included_unique_values, operator: number_filtering_operator, value: number_filtering_value, type: t });
        }
        filter_update_key.k += 1;
    }

    async function handle_item_checkbox_toggling(ev: any, item: any) {
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
    }

    async function handle_dropdown_toggle() {
        show_dropdown = !show_dropdown;
        if (show_dropdown) {
            // Khi mở dropdown, mặc định tick chọn tất cả các giá trị đang hiển thị
            if (included_unique_values.size === 0) {
                filtered_unique_vals.forEach(v => included_unique_values.add(v));
            }
            api.exec("resize-column", { id: column.id, width: 250 });
        } else {
            api.exec("resize-column", { id: column.id, width: col_width });
            await writeFilter();
        }
    }

    async function erase_filter() {
        sort_by_id.delete(column.id);
        filter_by_id.delete(column.id);
        string_filtering_value = "";
        included_unique_values.clear();
        api.exec("resize-column", { id: column.id, width: col_width });
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
                        <div style="min-width: 250px; padding: 10px; padding-top: 0px">
                            <p style="margin-bottom: 5px; margin-top: 10px">Sắp xếp</p>
                            <div style="display: flex; gap: 5px">
                                <button onclick={handle_dropdown_toggle} style="background: transparent; border: transparent">
                                    <Segmented onchange={handle_sorter_toggle} bind:value={sort_direction} options={[
                                        {id: 1, label:"A đến Z", icon:"mdi mdi-sort-alphabetical-ascending"},
                                        {id: -1, label:"Z đến A", icon:"mdi mdi-sort-alphabetical-descending"}
                                    ]}></Segmented>
                                </button>
                            </div>

                            <p style="margin-bottom: 5px; margin-top: 10px">Lọc</p>

                            <Text bind:value={string_filtering_value} placeholder="Tìm kiếm..."></Text>
                            <div style="display: flex; max-height: 170px; overflow-y: scroll; flex-direction: column; gap: 5px; padding-top: 5px">
                                <div style="height: 32px;">
                                    <Button onclick={handle_selectall_toggle}>Chọn/Bỏ chọn tất cả</Button>
                                </div>
                                {#each filtered_unique_vals as unique_val}
                                    <Checkbox value={included_unique_values.has(unique_val)} onchange={async (ev: any) => {handle_item_checkbox_toggling(ev, unique_val)}} label={String(unique_val)}></Checkbox>
                                {/each}
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
                        <div style="min-width: 250px; padding: 10px; padding-top: 0px">
                            <p style="margin-bottom: 5px; margin-top: 10px">Sắp xếp</p>
                            <div style="display: flex; gap: 5px">
                                <button onclick={handle_dropdown_toggle} style="background: transparent; border: transparent">
                                    <Segmented onchange={handle_sorter_toggle} bind:value={sort_direction} options={[
                                        {id: 1, label:"Tăng dần", icon:"mdi mdi-arrow-up"},
                                        {id: -1, label:"Giảm dần", icon:"mdi mdi-arrow-down"}
                                    ]}></Segmented>
                                </button>
                            </div>

                            <p style="margin-bottom: 5px; margin-top: 10px">Lọc</p>
                            <div style="display: flex; gap: 5px">
                                <Select bind:value={number_filtering_operator} options={number_filtering_options}></Select>
                                <Text bind:value={number_filtering_value} placeholder="Nhập số..."></Text>
                            </div>

                            <div style="display: flex; max-height: 170px; overflow-y: scroll; flex-direction: column; gap: 5px; padding-top: 5px">
                                <div style="height: 32px;">
                                    <Button onclick={handle_selectall_toggle}>Chọn/Bỏ chọn tất cả</Button>
                                </div>
                                {#each filtered_unique_vals as unique_val}
                                    <Checkbox value={included_unique_values.has(unique_val)} label={String(unique_val)} onchange={(ev: any) => {handle_item_checkbox_toggling(ev, unique_val)}}></Checkbox>
                                {/each}
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
