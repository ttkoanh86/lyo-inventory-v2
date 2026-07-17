<script>
    // @ts-ignore
    import { Willow, Text, Button, Field } from "wx-svelte-core";
    import { Axios, HttpStatusCode } from "axios";
    import { goto } from "$app/navigation";
    import { onMount } from "svelte";
    import { lazyLoadStylesheets } from "../dashboard/lazyLoadScript";

    let authUrl = "";
    let checkOnlyUrl = "";
    if (import.meta.env.MODE === "development") {
        authUrl = "http://localhost:8080/auth";
        checkOnlyUrl = "http://localhost:8080/check_only";
    } else {
        authUrl =
            "https://ninee35ef3e539b-inventory-mgmt-proxy.onrender.com/auth";
        checkOnlyUrl =
            "https://ninee35ef3e539b-inventory-mgmt-proxy.onrender.com/check_only";
    }
    let a = new Axios();

    a.interceptors.response.use(
        (response) => {
            return response;
        },
        (error) => {
            if (error.response && error.response.status === 401) {
                console.error("Unauthorized access:", error.response.data);
            } else if (error.response && error.response.status === 500) {
                console.error("Server error:", error.response.data);
            } else {
                console.error("An error occurred:", error.message);
            }
            return Promise.reject(error);
        },
    );

    let username = $state("");
    let password = $state("");

    // BỘ NÃO ĐIỀU HƯỚNG ĐÃ ĐƯỢC CẬP NHẬT TẠI ĐÂY
    onMount(async () => {
        lazyLoadStylesheets(
            "https://cdn.jsdelivr.net/npm/@mdi/font@7.4.47/css/materialdesignicons.min.css",
        );

        // Ép trang web tự động bỏ qua đăng nhập và chạy thẳng vào trang số liệu!
        await goto("dashboard", { invalidateAll: false });
    });

    let password_shown = $state(false);

    async function auth() {
        // Tự động cho qua nếu bấm nút
        await goto("dashboard", { invalidateAll: false });
    }
</script>

<Willow fonts={false}>
    <div class="outer">
        <div class="inner">
            <h1>Đăng nhập</h1>
            <p style="color: green; margin-bottom: 15px;">Hệ thống đang chuyển hướng vào Dashboard...</p>
            <div style="padding-top: 10px;">
                <Button onclick={auth} type="primary block">Vào thẳng Dashboard</Button>
            </div>
        </div>
    </div>

    <style>
        /* Switch accent color */
        .wx-willow-theme {
            --wx-color-primary: #0520c3;
        }
        .outer {
            width: 100%;
            height: 100dvh;
            align-content: center;
            justify-items: center;
            background-color: rgba(246, 246, 246, 0.741);
        }

        .inner {
            padding: 40px;
            background-color: white;
            border: 1px solid rgb(234, 234, 234);
            width: 400px;
            text-align: center;
        }
    </style>
</Willow>
