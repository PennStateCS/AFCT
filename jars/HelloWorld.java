public class HelloWorld {
    public static void main(String[] args) {
        System.out.println("Hello from Java!");
        System.out.println("Arguments received: " + String.join(", ", args));
        if (args.length > 0) {
            System.out.println("First argument: " + args[0]);
        }
    }
}
