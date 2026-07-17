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
        
        // 🔐 CHỊ CÓ THỂ ĐỔI TÀI KHOẢN VÀ MẬT KHẨU Ở ĐÂY Theo Ý MUỐN
        const TAI_KHOAN_CHUAN = "admin";
        const MAT_KHAU_CHUAN = "lyo12345"; 

        if (username === TAI_KHOAN_CHUAN && password === MAT_KHAU_CHUAN) {
            // Đánh dấu đã đăng nhập thành công vào trình duyệt
            sessionStorage.setItem("isLoggedIn", "true");
            sessionStorage.setItem("token", "DUMMY_TOKEN"); // Tạo token ảo để mồi hệ thống
            
            // Vào thẳng trang số liệu
            await goto("dashboard", { invalidateAll: false });
        } else {
            alert("Tài khoản hoặc Mật khẩu chị gõ chưa chính xác rồi ạ!");
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
