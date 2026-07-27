function handle_location_update() {
        is_loading = true;

        datasource = calculate_restock_data(
            [...order_records, ...transfer_records],
            variant_by_id,
            Number(c_location_id), // 🟢 ÉP KIỂU SỐ CHO C_LOCATION_ID
        );
        low_sales_skus = get_low_sales_skus(datasource);
        selected_skus.clear();
        filter_by_id.clear();
        sort_by_id.clear();

        rowCount = datasource.length;
        resetPagination(); 

        is_loading = false;
        c_location = locations.find((v) => Number(v.id) === Number(c_location_id)) as Location;
        grid_key++;
    }

    async function initialize() {
        is_loading = true;
        let loc_and_variant = await Promise.all([
            get_locations(),
            get_active_products(),
        ]);
        locations = loc_and_variant[0];
        variant_by_id = loc_and_variant[1];

        let order_and_transfer_records = await Promise.all([
            fetch_order_record(variant_by_id),
            fetch_inventory_transfer(variant_by_id),
        ]);
        order_records = order_and_transfer_records[0];
        transfer_records = order_and_transfer_records[1];

        // 🟢 SỬA LỖI BẰNG CÁCH GÁN C_LOCATION_ID TRƯỚC KHI TRUYỀN VÀO HÀM CALCULATE
        c_location_id = Number(locations[0].id);

        datasource = calculate_restock_data(
            [...order_records, ...transfer_records],
            variant_by_id,
            c_location_id,
        );

        setLastDataUpdate();

        low_sales_skus = get_low_sales_skus(datasource);
        rowCount = datasource.length;
        
        resetPagination(); 
        grid_key++;
        is_loading = false;
        
        // @ts-ignore
        updateKeys.dsource = datasource;
        updateKeys.headerSorterKey++;

        c_location = locations[0];
    }
