<script>
    // @ts-ignore
    import { Willow, Text, Button, Field } from "wx-svelte-core";
    import { goto } from "$app/navigation";
    import { onMount } from "svelte";
    import { lazyLoadStylesheets } from "../dashboard/lazyLoadScript";

    let username = $state("");
    let password = $state("");
    let password_shown = $state(false);

    onMount(async () => {
        lazyLoadStylesheets(
            "https://cdn.jsdelivr.net/npm/@mdi/font@7.4.47/css/materialdesignicons.min.css",
        );
        // Nếu đã đăng nhập trước đó rồi thì vào thẳng, không bắt đăng nhập lại
        if (sessionStorage.getItem("isLoggedIn") === "true") {
            await goto("dashboard", { invalidateAll: false });
        }
    });

    async function auth() {
        password_shown = false;
        
        try {
            // Gọi API thật về Proxy để lấy Token từ Valkey
            const response = await fetch("https://lyo-inventory-proxy-x79b.onrender.com/auth", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ username, password })
            });

            if (response.ok) {
                const data = await response.json();
                
                // Lưu Token xịn do Proxy cấp vào LocalStorage và SessionStorage
                localStorage.setItem("token", data.token);
                sessionStorage.setItem("token", data.token);
                sessionStorage.setItem("isLoggedIn", "true");
                
                // Vào thẳng dashboard
                await goto("dashboard", { invalidateAll: false });
            } else {
                alert("Tài khoản hoặc Mật khẩu chưa chính xác rồi ạ!");
            }
        } catch (error) {
            console.error("Lỗi đăng nhập:", error);
            alert("Không thể kết nối đến máy chủ Proxy!");
        }
    }
</script>

<Willow fonts={false}>
    <div class="outer">
        <div class="inner">
            <h1>Đăng nhập Hệ thống LYO</h1>
            <form on:submit|preventDefault={auth}>
                <Field label="Username">
                    <Text
                        bind:value={username}
                        autocomplete="username"
                        type="text"
                        placeholder="Nhập Username"
                    ></Text>
                </Field>
                <Field label="Password">
                    {#if !password_shown}
                        <div style="display: flex; gap: 10px">
                            <Text
                                bind:value={password}
                                autocomplete="current-password"
                                type="password"
                                placeholder="Nhập Password"
                            ></Text>
                            <div style="width: 32px;">
                                <Button
                                    icon="mdi mdi-eye"
                                    type="secondary"
                                    onclick={() => {
                                        password_shown = !password_shown;
                                    }}
                                ></Button>
                            </div>
                        </div>
                    {:else}
                        <div style="display: flex; gap: 10px">
                            <Text
                                bind:value={password}
                                autocomplete="current-password"
                                type="text"
                                placeholder="Nhập Password"
                            ></Text>
                            <div style="width: 32px;">
                                <Button
                                    icon="mdi mdi-eye-off"
                                    type="secondary"
                                    onclick={() => {
                                        password_shown = !password_shown;
                                    }}
                                ></Button>
                            </div>
                        </div>
                    {/if}
                </Field>
            </form>

            <div style="padding-top: 20px;">
                <Button onclick={auth} type="primary block">Đăng nhập</Button>
            </div>
        </div>
    </div>

    <style>
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
        }
        h1 {
            text-align: center;
            margin-bottom: 20px;
            font-size: 24px;
        }
    </style>
</Willow>
